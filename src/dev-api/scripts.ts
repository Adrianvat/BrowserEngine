import { validateScripts, type Script, type ScriptKind } from "../engine";
import { callApi, type ApiOptions } from "./call";

/** Where scripts are kept: the project's files, through the dev server's API. */
export interface ScriptFilesClient {
  /** Every script. Throws when the files can't be reached (no dev server, say). */
  load(): Promise<Script[]>;
  write(kind: ScriptKind, name: string, code: string): Promise<void>;
  remove(kind: ScriptKind, name: string): Promise<void>;
  /** The systems' order; systems left out keep running, after these. */
  setOrder(systems: readonly string[]): Promise<void>;
  /** Switches a system off (its file stays; the game skips it) or on again. */
  setEnabled(name: string, enabled: boolean): Promise<void>;
}

/** The dev server's /api/scripts (see tools/script-files.ts for the routes). */
export class ScriptsApi implements ScriptFilesClient {
  private readonly options: ApiOptions;

  constructor(base = "/api/scripts", fetchFn?: typeof fetch) {
    this.options = { base, fetchFn };
  }

  async load(): Promise<Script[]> {
    return validateScripts(await callApi(this.options, "GET", ""));
  }

  async write(kind: ScriptKind, name: string, code: string): Promise<void> {
    await callApi(this.options, "PUT", `/${kind}s/${name}`, { code });
  }

  async remove(kind: ScriptKind, name: string): Promise<void> {
    await callApi(this.options, "DELETE", `/${kind}s/${name}`);
  }

  async setOrder(systems: readonly string[]): Promise<void> {
    await callApi(this.options, "PUT", "/order", { systems: [...systems] });
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    await callApi(this.options, "PUT", `/systems/${name}/enabled`, { enabled });
  }
}
