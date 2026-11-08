import {
  BUILT_IN_SYSTEMS,
  scriptPath,
  type LoadedComponent,
  type LoadedScene,
  type LoadedScripts,
  type LoadedSystem,
  type Script,
  type ScriptKind,
} from "../engine";
import type { ScriptLibrary } from "./library";
import { builtInSystemTemplate, templateFor } from "./templates";

/** Which script: its kind and name. */
export interface ScriptRef {
  kind: ScriptKind;
  name: string;
}

/** Loads a script set the way the game will: what each script defines, or why it failed. */
export type Checker = (scripts: readonly Script[]) => Promise<LoadedScripts>;

export interface CodeEditorOptions {
  library: ScriptLibrary;
  checker: Checker;
  /** The game's scene names, for templates. */
  sceneNames: readonly string[];
  /** How long after the last keystroke a check runs, in ms. */
  checkDelay?: number;
}

/** What the last check found out about one script. */
export interface CheckInfo {
  error: string | null;
  system: LoadedSystem | null;
  component: LoadedComponent | null;
  scene: LoadedScene | null;
}

/**
 * The code editor's session: which script is open, the text typed but not yet saved (a
 * draft per script, so switching scripts loses nothing), and the result of checking the
 * scripts with the drafts applied. Saving writes every draft to its file.
 */
export class CodeEditorModel {
  private readonly library: ScriptLibrary;
  private readonly checker: Checker;
  private readonly sceneNames: readonly string[];
  private readonly checkDelay: number;
  private selection: ScriptRef | null = null;
  private readonly drafts = new Map<string, string>();
  private readonly listeners: (() => void)[] = [];
  private checkResult: LoadedScripts | null = null;
  private checkFailure: string | null = null;
  /** What the last finished or running check looked at, to skip checking the same again. */
  private lastChecked = "";
  private pendingChecks = 0;
  private latestCheck = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** True while save() writes several drafts, so they are checked once, together. */
  private saving = false;

  constructor(options: CodeEditorOptions) {
    this.library = options.library;
    this.checker = options.checker;
    this.sceneNames = options.sceneNames;
    this.checkDelay = options.checkDelay ?? 400;
    this.library.onChange(() => {
      this.dropStaleDrafts();
      this.notify();
      if (!this.saving) void this.check();
    });
    void this.check();
  }

  get scripts(): readonly Script[] {
    return this.library.scripts;
  }

  get selected(): ScriptRef | null {
    return this.selection;
  }

  /** The open script's text: its draft, or its saved code. Null with nothing open. */
  get text(): string | null {
    if (!this.selection) return null;
    const { kind, name } = this.selection;
    return this.drafts.get(scriptPath(kind, name)) ?? this.library.get(kind, name)?.code ?? null;
  }

  /** Whether any script has unsaved text. */
  get dirty(): boolean {
    return this.drafts.size > 0;
  }

  /** True while a check is running. */
  get checking(): boolean {
    return this.pendingChecks > 0;
  }

  /** Set when the checker itself failed (not a script); null otherwise. */
  get checkError(): string | null {
    return this.checkFailure;
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  isDirty(kind: ScriptKind, name: string): boolean {
    return this.drafts.has(scriptPath(kind, name));
  }

  /** What the last check found about a script; nothing until the first check finishes. */
  infoOf(kind: ScriptKind, name: string): CheckInfo | null {
    const result = this.checkResult;
    if (!result) return null;
    const errors = result.errors.filter((error) => error.kind === kind && error.name === name);
    return {
      error: errors.length > 0 ? errors.map((error) => error.message).join("\n") : null,
      system:
        kind === "system" ? (result.systems.find((system) => system.name === name) ?? null) : null,
      component:
        kind === "component"
          ? (result.components.find((component) => component.name === name) ?? null)
          : null,
      scene: kind === "scene" ? (result.scenes.find((scene) => scene.name === name) ?? null) : null,
    };
  }

  select(ref: ScriptRef | null): void {
    if (ref && !this.library.has(ref.kind, ref.name)) {
      throw new Error(`No ${ref.kind} "${ref.name}"`);
    }
    this.selection = ref ? { kind: ref.kind, name: ref.name } : null;
    this.notify();
  }

  /** Changes the open script's text without saving it, and checks it shortly after. */
  edit(text: string): void {
    if (!this.selection) throw new Error("No script is open");
    const { kind, name } = this.selection;
    const path = scriptPath(kind, name);
    if (text === this.library.get(kind, name)?.code) this.drafts.delete(path);
    else this.drafts.set(path, text);
    this.notify();
    this.scheduleCheck();
  }

  /** Saves every draft to its file. A draft whose write fails stays a draft. */
  async save(): Promise<void> {
    if (this.drafts.size === 0) return;
    this.cancelScheduledCheck();
    const drafts = [...this.drafts.entries()];
    this.drafts.clear();
    this.saving = true;
    // Every draft goes into the library at once (the writes follow one another).
    const writes: Promise<void>[] = [];
    try {
      for (const [path, text] of drafts) {
        const script = this.library.scripts.find((s) => scriptPath(s.kind, s.name) === path);
        if (!script) continue;
        const written = this.library.setCode(script.kind, script.name, text).catch(() => {
          // The library's status says why; the text is kept as a draft to try again.
          if (this.library.get(script.kind, script.name)?.code !== text) this.drafts.set(path, text);
        });
        writes.push(written);
      }
    } finally {
      this.saving = false;
    }
    await Promise.all(writes);
    this.notify();
    void this.check();
  }

  /** Drops the open script's draft. */
  discard(): void {
    if (!this.selection) return;
    const { kind, name } = this.selection;
    if (!this.drafts.delete(scriptPath(kind, name))) return;
    this.notify();
    this.scheduleCheck();
  }

  /**
   * Adds a script from a template, writes its file and opens it. Throws at once for a
   * bad name; the promise tells whether the file was written.
   */
  add(kind: ScriptKind, name: string): Promise<void> {
    const written = this.library.add(kind, name, templateFor(kind, name, this.sceneNames));
    this.select({ kind, name });
    return written;
  }

  /** Adds one of the engine's systems (see BUILT_IN_SYSTEMS) as a script, writes its file and opens it. */
  addBuiltInSystem(name: string): Promise<void> {
    const system = BUILT_IN_SYSTEMS.find((candidate) => candidate.name === name);
    if (!system) throw new Error(`The engine has no system "${name}"`);
    const written = this.library.add("system", name, builtInSystemTemplate(system, this.sceneNames));
    this.select({ kind: "system", name });
    return written;
  }

  /** Removes a script (and its draft) and deletes its file. */
  remove(kind: ScriptKind, name: string): Promise<void> {
    this.drafts.delete(scriptPath(kind, name));
    if (this.selection?.kind === kind && this.selection.name === name) this.selection = null;
    return this.library.remove(kind, name);
  }

  /** Switches a system off (keeping its file) or on again; the check runs on it either way. */
  setEnabled(name: string, enabled: boolean): Promise<void> {
    return this.library.setEnabled(name, enabled);
  }

  move(kind: ScriptKind, name: string, direction: -1 | 1): Promise<void> {
    return this.library.move(kind, name, direction);
  }

  /** The scripts as they would be saved now: the library's, with the drafts applied. */
  withDrafts(): Script[] {
    return this.library.scripts.map((script) => {
      const draft = this.drafts.get(scriptPath(script.kind, script.name));
      return draft === undefined ? script : { ...script, code: draft };
    });
  }

  /**
   * Checks the scripts (with drafts) now, unless they are what was checked last. A later
   * check's result always wins.
   */
  async check(): Promise<void> {
    this.cancelScheduledCheck();
    const scripts = this.withDrafts();
    const key = JSON.stringify(scripts);
    if (key === this.lastChecked && this.checkFailure === null) return;
    this.lastChecked = key;
    const id = ++this.latestCheck;
    this.pendingChecks++;
    this.notify();
    try {
      const result = await this.checker(scripts);
      if (id === this.latestCheck) {
        this.checkResult = result;
        this.checkFailure = null;
      }
    } catch (error) {
      if (id === this.latestCheck) {
        this.checkFailure = error instanceof Error ? error.message : String(error);
      }
    } finally {
      this.pendingChecks--;
      this.notify();
    }
  }

  private scheduleCheck(): void {
    this.cancelScheduledCheck();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.check();
    }, this.checkDelay);
  }

  private cancelScheduledCheck(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  /** After the library changed (e.g. from another page): forget what no longer applies. */
  private dropStaleDrafts(): void {
    for (const path of [...this.drafts.keys()]) {
      const script = this.library.scripts.find((s) => scriptPath(s.kind, s.name) === path);
      if (!script) this.drafts.delete(path);
      else if (script.code === this.drafts.get(path)) this.drafts.delete(path);
    }
    const { selection } = this;
    if (selection && !this.library.has(selection.kind, selection.name)) this.selection = null;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
