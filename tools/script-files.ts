import {
  arrangeScripts,
  ORDER_FILE,
  parseScriptOrder,
  scriptFile,
  scriptFromFile,
  type ScriptOrder,
} from "../src/engine/scripting/files.ts";
import {
  isScriptKind,
  isScriptName,
  SCRIPT_KINDS,
  type Script,
  type ScriptKind,
} from "../src/engine/scripting/script.ts";
import {
  ApiError,
  join,
  parseBody,
  respond,
  type ApiRequest,
  type ApiResponse,
  type FileSystem,
} from "./api.ts";

function checkName(kind: ScriptKind, name: string): void {
  if (!isScriptName(name)) throw new Error(`"${name}" is not a valid ${kind} name`);
}

/**
 * A project's scripts as files in a folder (see engine/scripting/files): reading them all,
 * writing or deleting one, setting the systems' order and switching a system off or on
 * (the order file remembers which are off). Every write goes to disk at
 * once; nothing is cached, so edits made with other tools are always seen.
 */
export class ScriptFiles {
  constructor(
    /** The scripts folder, e.g. "projects/demo/scripts". */
    private readonly root: string,
    private readonly fs: FileSystem,
  ) {}

  /** Every script, systems first in their order, then components by name. */
  async list(): Promise<Script[]> {
    const files: Record<string, string> = {};
    for (const kind of SCRIPT_KINDS) {
      const folder = join(this.root, `${kind}s`);
      for (const entry of await this.fs.list(folder)) {
        const path = `${kind}s/${entry}`;
        if (!scriptFromFile(path)) continue;
        const code = await this.fs.read(join(folder, entry));
        if (code !== null) files[path] = code;
      }
    }
    return arrangeScripts(files, await this.order());
  }

  /** Writes a script's file; a new system goes last in the order. */
  async write(kind: ScriptKind, name: string, code: string): Promise<void> {
    checkName(kind, name);
    await this.fs.write(join(this.root, scriptFile(kind, name)), code);
    if (kind !== "system") return;
    const order = await this.order();
    if (!order.systems.includes(name)) await this.writeOrder({ ...order, systems: [...order.systems, name] });
  }

  /** Deletes a script's file; a system also leaves the order (and the disabled list). */
  async remove(kind: ScriptKind, name: string): Promise<void> {
    checkName(kind, name);
    await this.fs.remove(join(this.root, scriptFile(kind, name)));
    if (kind !== "system") return;
    const order = await this.order();
    if (order.systems.includes(name) || order.disabled.includes(name)) {
      await this.writeOrder({
        systems: order.systems.filter((other) => other !== name),
        disabled: order.disabled.filter((other) => other !== name),
      });
    }
  }

  /** Sets the systems' order. Every name must be a system; systems left out go last. */
  async setOrder(systems: readonly string[]): Promise<void> {
    const existing = (await this.list()).filter((s) => s.kind === "system").map((s) => s.name);
    const unknown = systems.find((name) => !existing.includes(name));
    if (unknown !== undefined) throw new Error(`There is no system "${unknown}"`);
    const ordered = [...new Set(systems)];
    const order = await this.order();
    await this.writeOrder({
      ...order,
      systems: [...ordered, ...existing.filter((name) => !ordered.includes(name))],
    });
  }

  /** Switches an existing system off (its file stays, the game skips it) or on again. */
  async setEnabled(name: string, enabled: boolean): Promise<void> {
    checkName("system", name);
    const existing = (await this.list()).filter((s) => s.kind === "system").map((s) => s.name);
    if (!existing.includes(name)) throw new Error(`There is no system "${name}"`);
    const order = await this.order();
    const disabled = order.disabled.filter((other) => other !== name);
    if (!enabled) disabled.push(name);
    await this.writeOrder({ ...order, disabled });
  }

  private async order(): Promise<ScriptOrder> {
    const text = await this.fs.read(join(this.root, ORDER_FILE));
    if (text === null) return { systems: [], disabled: [] };
    try {
      return parseScriptOrder(JSON.parse(text));
    } catch {
      return { systems: [], disabled: [] };
    }
  }

  /** Writes the order file; the disabled list is left out while it is empty. */
  private writeOrder(order: ScriptOrder): Promise<void> {
    const value = order.disabled.length === 0 ? { systems: order.systems } : order;
    const text = JSON.stringify(value, null, 2) + "\n";
    return this.fs.write(join(this.root, ORDER_FILE), text);
  }
}

/**
 * The scripts API the code editor talks to:
 *   GET    /                        -> { version: 1, scripts: [...] }
 *   PUT    /order                   { systems: [names] }
 *   PUT    /<kind>s/<name>          { code }
 *   DELETE /<kind>s/<name>
 *   PUT    /systems/<name>/enabled  { enabled: true | false }
 */
export function handleScriptsRequest(
  files: ScriptFiles,
  request: ApiRequest,
): Promise<ApiResponse> {
  return respond(async () => {
    const path = request.path.replace(/\/$/, "");
    if (path === "" && request.method === "GET") {
      return { status: 200, body: { version: 1, scripts: await files.list() } };
    }
    if (path === "/order" && request.method === "PUT") {
      const { systems } = parseBody(request.body);
      if (!Array.isArray(systems) || !systems.every((name) => typeof name === "string")) {
        throw new ApiError(400, '"systems" must be an array of system names');
      }
      await files.setOrder(systems as string[]);
      return { status: 200, body: { ok: true } };
    }
    const enabled = /^\/systems\/([^/]+)\/enabled$/.exec(path);
    if (enabled && request.method === "PUT") {
      const name = enabled[1];
      if (!isScriptName(name)) throw new ApiError(400, `"${name}" is not a valid script name`);
      const value = parseBody(request.body).enabled;
      if (typeof value !== "boolean") throw new ApiError(400, '"enabled" must be true or false');
      await files.setEnabled(name, value);
      return { status: 200, body: { ok: true } };
    }
    const script = /^\/(system|component|scene)s\/([^/]+)$/.exec(path);
    if (script && (request.method === "PUT" || request.method === "DELETE")) {
      const [, kind, name] = script;
      if (!isScriptKind(kind) || !isScriptName(name)) {
        throw new ApiError(400, `"${name}" is not a valid script name`);
      }
      if (request.method === "DELETE") {
        await files.remove(kind, name);
      } else {
        const { code } = parseBody(request.body);
        if (typeof code !== "string") throw new ApiError(400, '"code" must be a string');
        await files.write(kind, name, code);
      }
      return { status: 200, body: { ok: true } };
    }
    throw new ApiError(404, `No such route: ${request.method} ${request.path}`);
  });
}
