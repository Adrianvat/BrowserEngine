import type { Script, ScriptKind } from "../../src/engine";
import type { ScriptFilesClient } from "../../src/dev-api/scripts";

/** Stands in for the dev server's files: scripts in memory, every call logged, failures on demand. */
export class FakeScriptFiles implements ScriptFilesClient {
  scripts: Script[];
  readonly calls: string[] = [];
  /** When set, every call fails with this message. */
  failure: string | null = null;
  /** When false, load() fails as if there were no dev server. */
  reachable = true;

  constructor(scripts: readonly Script[] = []) {
    this.scripts = scripts.map((script) => ({ ...script }));
  }

  async load(): Promise<Script[]> {
    this.calls.push("load");
    if (!this.reachable) throw new Error("The scripts API is not there");
    this.check();
    return this.scripts.map((script) => ({ ...script }));
  }

  async write(kind: ScriptKind, name: string, code: string): Promise<void> {
    this.calls.push(`write ${kind}s/${name}`);
    this.check();
    const existing = this.scripts.find((s) => s.kind === kind && s.name === name);
    if (existing) existing.code = code;
    else this.scripts.push({ kind, name, code });
  }

  async remove(kind: ScriptKind, name: string): Promise<void> {
    this.calls.push(`remove ${kind}s/${name}`);
    this.check();
    this.scripts = this.scripts.filter((s) => !(s.kind === kind && s.name === name));
  }

  async setOrder(systems: readonly string[]): Promise<void> {
    this.calls.push(`order ${systems.join(",")}`);
    this.check();
    const byName = new Map(this.scripts.filter((s) => s.kind === "system").map((s) => [s.name, s]));
    const ordered = [
      ...systems.map((name) => byName.get(name)!).filter(Boolean),
      ...[...byName.values()].filter((s) => !systems.includes(s.name)),
    ];
    this.scripts = [...ordered, ...this.scripts.filter((s) => s.kind !== "system")];
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    this.calls.push(`${enabled ? "enable" : "disable"} ${name}`);
    this.check();
    const script = this.scripts.find((s) => s.kind === "system" && s.name === name);
    if (!script) throw new Error(`There is no system "${name}"`);
    if (enabled) delete script.disabled;
    else script.disabled = true;
  }

  /** Whether a system is switched off, or undefined when there is no such system. */
  isDisabled(name: string): boolean | undefined {
    const script = this.scripts.find((s) => s.kind === "system" && s.name === name);
    return script && script.disabled === true;
  }

  codeOf(kind: ScriptKind, name: string): string | undefined {
    return this.scripts.find((s) => s.kind === kind && s.name === name)?.code;
  }

  private check(): void {
    if (this.failure !== null) throw new Error(this.failure);
  }
}
