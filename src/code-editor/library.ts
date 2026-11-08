import { isScriptName, scriptPath, type Script, type ScriptKind } from "../engine";
import type { ScriptFilesClient } from "../dev-api/scripts";

/**
 * Whether the scripts on disk match what is shown. "readOnly": the files can't be
 * reached (no dev server), so the bundled scripts are shown and nothing can change.
 * A failed write keeps the change in memory and says why.
 */
export type SaveStatus = "saved" | "saving" | "readOnly" | { error: string };

export interface ScriptLibraryOptions {
  files: ScriptFilesClient;
  /** What to show when the files can't be reached: the scripts bundled with the page. */
  fallback?: () => Promise<readonly Script[]>;
  /** Component names scripts can't use: the built-in components and those defined in code. */
  reservedComponentNames?: readonly string[];
  /** The project's scenes: a scene script can only be for one of them. */
  sceneNames?: readonly string[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function label(kind: ScriptKind, name: string): string {
  return `${kind} "${name}"`;
}

/**
 * The project's scripts, as the files in its scripts folder. Every change is
 * written to its file at once, one write after another; the list in memory changes
 * first, so the page never waits for the disk. The systems' order is the list's order.
 */
export class ScriptLibrary {
  private list: Script[] = [];
  private saveStatus: SaveStatus = "saved";
  private error: string | null = null;
  private pending = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners: (() => void)[] = [];
  private readonly files: ScriptFilesClient;
  private readonly fallback: (() => Promise<readonly Script[]>) | null;
  private readonly reserved: ReadonlySet<string>;
  private readonly sceneNames: readonly string[] | null;

  constructor(options: ScriptLibraryOptions) {
    this.files = options.files;
    this.fallback = options.fallback ?? null;
    this.reserved = new Set(options.reservedComponentNames ?? []);
    this.sceneNames = options.sceneNames ?? null;
  }

  /** Every script, in order. */
  get scripts(): readonly Script[] {
    return this.list;
  }

  get status(): SaveStatus {
    return this.saveStatus;
  }

  /** True when the files can't be reached; the scripts shown then can't be changed. */
  get readOnly(): boolean {
    return this.saveStatus === "readOnly";
  }

  /** Set when the scripts could not be read at all. */
  get loadError(): string | null {
    return this.error;
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** Reads the scripts from the files (or the fallback). Called once at the start. */
  async load(): Promise<void> {
    this.error = null;
    try {
      this.list = await this.files.load();
      this.saveStatus = "saved";
    } catch (error) {
      const reason = messageOf(error);
      if (this.fallback) {
        try {
          this.list = [...(await this.fallback())];
          this.saveStatus = "readOnly";
          this.error = null;
        } catch (fallbackError) {
          this.error = `${reason}; ${messageOf(fallbackError)}`;
        }
      } else {
        this.error = reason;
      }
    }
    this.notify();
  }

  /** Re-reads the files, e.g. after another program changed them. Read-only stays as is. */
  async reload(): Promise<void> {
    if (this.readOnly) return;
    try {
      this.list = await this.files.load();
      this.error = null;
      // What is shown is what is on disk again (unless writes are still on their way).
      if (this.pending === 0) this.saveStatus = "saved";
    } catch (error) {
      this.error = messageOf(error);
    }
    this.notify();
  }

  ofKind(kind: ScriptKind): Script[] {
    return this.list.filter((script) => script.kind === kind);
  }

  get(kind: ScriptKind, name: string): Script | undefined {
    return this.list.find((script) => script.kind === kind && script.name === name);
  }

  has(kind: ScriptKind, name: string): boolean {
    return this.get(kind, name) !== undefined;
  }

  /** Why `name` can't be used for a new script of this kind, or null when it can. */
  nameProblem(kind: ScriptKind, name: string): string | null {
    if (!isScriptName(name)) {
      return "A name must be an identifier: letters, digits, _ and $, not starting with a digit";
    }
    if (this.has(kind, name)) return `There is already a ${label(kind, name)}`;
    if (kind === "component" && this.reserved.has(name)) {
      return `"${name}" is a component the engine or the game defines in code; pick another name`;
    }
    if (kind === "scene" && this.sceneNames && !this.sceneNames.includes(name)) {
      return `There is no scene "${name}" in this project; add it in the scene editor first`;
    }
    return null;
  }

  /** Appends a script and writes its file. Throws at once for a bad name. */
  add(kind: ScriptKind, name: string, code: string): Promise<void> {
    this.checkEditable();
    const problem = this.nameProblem(kind, name);
    if (problem !== null) throw new Error(problem);
    this.list.push({ kind, name, code });
    return this.write(() => this.files.write(kind, name, code));
  }

  /** Removes a script and deletes its file. */
  remove(kind: ScriptKind, name: string): Promise<void> {
    this.checkEditable();
    this.list.splice(this.indexOf(kind, name), 1);
    return this.write(() => this.files.remove(kind, name));
  }

  /** Changes a script's code and writes its file. A failed write puts the old code back. */
  setCode(kind: ScriptKind, name: string, code: string): Promise<void> {
    this.checkEditable();
    const script = this.require(kind, name);
    const previous = script.code;
    script.code = code;
    return this.write(() => this.files.write(kind, name, code)).catch((error: unknown) => {
      if (script.code === code) script.code = previous;
      this.notify();
      throw error;
    });
  }

  /**
   * Adds or replaces these scripts (e.g. ones saved by an older version of the editor)
   * and puts the systems among them in their order, before the others.
   */
  async importScripts(scripts: readonly Script[]): Promise<void> {
    this.checkEditable();
    for (const { kind, name, code } of scripts) {
      if (this.has(kind, name)) await this.setCode(kind, name, code);
      else await this.add(kind, name, code);
    }
    const imported = scripts.filter((s) => s.kind === "system").map((s) => s.name);
    if (imported.length === 0) return;
    const rest = this.ofKind("system")
      .map((s) => s.name)
      .filter((name) => !imported.includes(name));
    const systems = [...imported, ...rest];
    const components = this.ofKind("component");
    this.list = [...systems.map((name) => this.get("system", name)!), ...components];
    await this.write(() => this.files.setOrder(systems));
  }

  /**
   * Switches a system off (its file and place in the order stay, but the game does not
   * run it) or on again. A failed write puts the old state back.
   */
  setEnabled(name: string, enabled: boolean): Promise<void> {
    this.checkEditable();
    const script = this.require("system", name);
    const before = script.disabled;
    if (enabled) delete script.disabled;
    else script.disabled = true;
    return this.write(() => this.files.setEnabled(name, enabled)).catch((error: unknown) => {
      if (before) script.disabled = true;
      else delete script.disabled;
      this.notify();
      throw error;
    });
  }

  /**
   * Swaps a script with the previous (-1) or next (+1) one of its kind, if there is one.
   * Systems' order is written to the order file; components' order is only for the list.
   */
  move(kind: ScriptKind, name: string, direction: -1 | 1): Promise<void> {
    this.checkEditable();
    const from = this.indexOf(kind, name);
    let to = from + direction;
    while (to >= 0 && to < this.list.length && this.list[to].kind !== kind) to += direction;
    if (to < 0 || to >= this.list.length) return Promise.resolve();
    [this.list[from], this.list[to]] = [this.list[to], this.list[from]];
    if (kind !== "system") {
      this.notify();
      return Promise.resolve();
    }
    const systems = this.ofKind("system").map((script) => script.name);
    return this.write(() => this.files.setOrder(systems));
  }

  /** Runs a file change after the earlier ones; the status follows it. */
  private write(action: () => Promise<void>): Promise<void> {
    this.pending++;
    this.saveStatus = "saving";
    this.notify();
    const result = this.queue.then(action).then(
      () => {
        this.pending--;
        if (this.pending === 0) this.saveStatus = "saved";
        this.notify();
      },
      (error: unknown) => {
        this.pending--;
        this.saveStatus = { error: messageOf(error) };
        this.notify();
        throw error;
      },
    );
    this.queue = result.catch(() => {});
    return result;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private checkEditable(): void {
    if (this.readOnly) throw new Error("The scripts can't be changed here: start the dev server");
    if (this.error !== null) throw new Error(`The scripts could not be read: ${this.error}`);
  }

  private indexOf(kind: ScriptKind, name: string): number {
    const index = this.list.findIndex((script) => script.kind === kind && script.name === name);
    if (index < 0) throw new Error(`No ${label(kind, name)} (${scriptPath(kind, name)})`);
    return index;
  }

  private require(kind: ScriptKind, name: string): Script {
    return this.list[this.indexOf(kind, name)];
  }
}
