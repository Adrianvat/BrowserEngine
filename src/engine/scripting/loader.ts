import {
  component,
  ComponentRegistry,
  isFieldKind,
  type ComponentDefinition,
  type FieldKind,
} from "../data/registry";
import type { System, World } from "../ecs/world";
import type { Scene } from "../scene/scene";
import { SYSTEM_PHASES, type SystemPhase } from "../scene/systems";
import {
  ENGINE_SPECIFIER,
  isUrlSpecifier,
  planLoad,
  rewriteImports,
  scriptPath,
  type Script,
  type ScriptError,
} from "./script";

/**
 * How the loader turns code into a module: a URL for the code that `import()` accepts.
 * The browser uses blob: URLs; tests use data: URLs, which work anywhere.
 */
export interface ModuleHost {
  /** A URL `import()` can load `code` from. `name` labels the module, e.g. in stack traces. */
  createUrl(code: string, name: string): string;
  importModule(url: string): Promise<Record<string, unknown>>;
  /** Called for every created URL once the load is over (the modules stay loaded). */
  releaseUrl?(url: string): void;
}

/** A host using data: URLs. Works in browsers and in Node, so tests can load real scripts. */
export const dataUrlHost: ModuleHost = {
  createUrl: (code) => `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`,
  importModule: (url) => import(/* @vite-ignore */ url),
};

/** A host using blob: URLs, which keep stack traces short. Needs a browser. */
export function blobUrlHost(): ModuleHost {
  return {
    createUrl: (code) => URL.createObjectURL(new Blob([code], { type: "text/javascript" })),
    importModule: (url) => import(/* @vite-ignore */ url),
    releaseUrl: (url) => URL.revokeObjectURL(url),
  };
}

export interface LoadedSystem {
  name: string;
  system: System;
  /** The scenes it runs in; null means every scene. */
  scenes: string[] | null;
  phase: SystemPhase;
  /** Switched off in the project: loaded and checked, but not run by the game. */
  disabled: boolean;
  /** False: added to its scenes switched off, until a script enables it (`export const startsEnabled`). */
  startsEnabled: boolean;
  /** The script's `onEnable`, run when the system starts running in a scene (see SystemDefinition). */
  onEnable: ((world: World) => void) | null;
  /** The script's `onDisable`, run when it stops. */
  onDisable: ((world: World) => void) | null;
  /** The module's exports, e.g. constants the script shares. */
  exports: Record<string, unknown>;
}

export interface LoadedComponent {
  name: string;
  definition: ComponentDefinition;
  exports: Record<string, unknown>;
}

/** A scene script: the setup code of the scene of that name. */
export interface LoadedScene {
  name: string;
  scene: Scene;
  exports: Record<string, unknown>;
}

export interface LoadedScripts {
  /** In script order. */
  components: LoadedComponent[];
  /** In script order, which is the order they run in. */
  systems: LoadedSystem[];
  /** In script order. */
  scenes: LoadedScene[];
  /** Scripts that did not load; the others are still usable. */
  errors: ScriptError[];
}

export interface LoadOptions {
  /** What `import { ... } from "engine"` provides: normally the engine module's namespace. */
  engine: Record<string, unknown>;
  host: ModuleHost;
  /** When given, a system naming a scene not in here, or a scene script for one, is an error. */
  sceneNames?: readonly string[];
  /**
   * The game's components defined in code. When given, a script component named like one
   * of them, or like a built-in component, is an error.
   */
  fixedComponents?: readonly ComponentDefinition[];
}

/** Where the engine namespace is handed to the "engine" module while scripts load. */
const HANDLE = "browser-engine:scripting";

let nextToken = 1;

function isIdentifier(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name) && name !== "default";
}

/** An ES module re-exporting the engine namespace, which it picks up from a global handle. */
function engineModuleCode(engine: Record<string, unknown>, token: string): string {
  const handle = `globalThis[${JSON.stringify(HANDLE)}][${JSON.stringify(token)}]`;
  const lines = [`const engine = ${handle};`];
  for (const name of Object.keys(engine)) {
    if (isIdentifier(name)) lines.push(`export const ${name} = engine.${name};`);
  }
  return lines.join("\n");
}

function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { lineNumber } = error as { lineNumber?: unknown };
  const where = typeof lineNumber === "number" ? ` (line ${lineNumber})` : "";
  return `${error.name}: ${error.message}${where}`;
}

/** One line per error: "systems/kick: ...". */
export function describeScriptErrors(errors: readonly ScriptError[]): string {
  return errors.map((error) => `${scriptPath(error.kind, error.name)}: ${error.message}`).join("\n");
}

/**
 * Loads scripts as ES modules, each after the scripts it imports, and reads what they
 * define: a system's function, scenes and phase; a component's class and fields; a scene
 * script's setup function. Every load evaluates every script afresh. Broken scripts are
 * reported in `errors`, not thrown.
 */
export async function loadScripts(
  scripts: readonly Script[],
  options: LoadOptions,
): Promise<LoadedScripts> {
  const { host } = options;
  const { order, errors } = planLoad(scripts);
  const components: LoadedComponent[] = [];
  const systems: LoadedSystem[] = [];
  const sceneScripts: LoadedScene[] = [];
  const fail = (script: Script, message: string): void => {
    errors.push({ kind: script.kind, name: script.name, message });
  };

  const token = String(nextToken++);
  const handles = ((globalThis as Record<string, unknown>)[HANDLE] ??= {}) as Record<
    string,
    unknown
  >;
  handles[token] = options.engine;
  const urls = new Map<string, string>();
  const created: string[] = [];
  try {
    const engineUrl = host.createUrl(engineModuleCode(options.engine, token), ENGINE_SPECIFIER);
    created.push(engineUrl);
    urls.set(ENGINE_SPECIFIER, engineUrl);

    const loadedPaths = new Set<string>();
    for (const { script, dependencies } of order) {
      const path = scriptPath(script.kind, script.name);
      const broken = dependencies.find((dependency) => !loadedPaths.has(dependency));
      if (broken !== undefined) {
        fail(script, `Can't load because "${broken}" failed`);
        continue;
      }
      // The trailing comment makes the code (and so a data: URL) unique to this load, so a
      // host that caches modules by URL still evaluates the script again.
      const code =
        rewriteImports(script.code, (specifier) =>
          isUrlSpecifier(specifier) ? specifier : (urls.get(specifier) ?? specifier),
        ) + `\n// load ${token}\n//# sourceURL=browser-engine/${path}.js`;
      const url = host.createUrl(code, path);
      created.push(url);
      let exports: Record<string, unknown>;
      try {
        exports = await host.importModule(url);
      } catch (error) {
        fail(script, messageOf(error));
        continue;
      }
      try {
        if (script.kind === "system") systems.push(readSystem(script.name, exports, script.disabled === true));
        else if (script.kind === "component") components.push(readComponent(script.name, exports));
        else sceneScripts.push(readScene(script.name, exports));
      } catch (error) {
        fail(script, error instanceof Error ? error.message : String(error));
        continue;
      }
      urls.set(path, url);
      loadedPaths.add(path);
    }
  } finally {
    delete handles[token];
    if (host.releaseUrl) for (const url of created) host.releaseUrl(url);
  }

  if (options.sceneNames) {
    for (const system of systems) {
      const unknown = (system.scenes ?? []).find((name) => !options.sceneNames!.includes(name));
      if (unknown === undefined) continue;
      errors.push({
        kind: "system",
        name: system.name,
        message: `There is no scene "${unknown}" (the scenes are ${options.sceneNames.join(", ")})`,
      });
    }
    for (const loaded of sceneScripts) {
      if (options.sceneNames.includes(loaded.name)) continue;
      errors.push({
        kind: "scene",
        name: loaded.name,
        message: `There is no scene "${loaded.name}" (the scenes are ${options.sceneNames.join(", ")}); add it in the scene editor first`,
      });
    }
  }
  if (options.fixedComponents) {
    const taken = new ComponentRegistry(options.fixedComponents);
    for (const loaded of components) {
      if (!taken.get(loaded.name)) continue;
      errors.push({
        kind: "component",
        name: loaded.name,
        message: `"${loaded.name}" is already a component, built into the engine or defined in code; pick another name`,
      });
    }
  }

  // Back in script order: the systems' order is the order they run in.
  const index = new Map(scripts.map((script, i) => [scriptPath(script.kind, script.name), i]));
  const position = (kind: Script["kind"], name: string) => index.get(scriptPath(kind, name)) ?? 0;
  const failed = new Set(errors.map((error) => scriptPath(error.kind, error.name)));
  return {
    components: components
      .filter((loaded) => !failed.has(scriptPath("component", loaded.name)))
      .sort((a, b) => position("component", a.name) - position("component", b.name)),
    systems: systems
      .filter((loaded) => !failed.has(scriptPath("system", loaded.name)))
      .sort((a, b) => position("system", a.name) - position("system", b.name)),
    scenes: sceneScripts
      .filter((loaded) => !failed.has(scriptPath("scene", loaded.name)))
      .sort((a, b) => position("scene", a.name) - position("scene", b.name)),
    errors,
  };
}

function readScene(name: string, exports: Record<string, unknown>): LoadedScene {
  const setup = exports.default;
  if (typeof setup !== "function") {
    throw new Error("A scene script must `export default` a function (scene) => void, its setup");
  }
  return { name, scene: { setup: setup as Scene["setup"] }, exports };
}

function readSystem(name: string, exports: Record<string, unknown>, disabled: boolean): LoadedSystem {
  const system = exports.default;
  if (typeof system !== "function") {
    throw new Error("A system script must `export default` a function (world, dt) => void");
  }
  const { scenes, phase, startsEnabled, onEnable, onDisable } = exports;
  const sceneList = Array.isArray(scenes) && scenes.every((s) => typeof s === "string");
  if (scenes !== undefined && !sceneList) {
    throw new Error('`export const scenes` must be an array of scene names, e.g. ["play"]');
  }
  if (phase !== undefined && !(SYSTEM_PHASES as readonly unknown[]).includes(phase)) {
    throw new Error('`export const phase` must be "update" or "render"');
  }
  if (startsEnabled !== undefined && typeof startsEnabled !== "boolean") {
    throw new Error("`export const startsEnabled` must be true or false");
  }
  for (const [hook, value] of [["onEnable", onEnable], ["onDisable", onDisable]] as const) {
    if (value !== undefined && typeof value !== "function") {
      throw new Error(`\`export function ${hook}(world)\` must be a function`);
    }
  }
  return {
    name,
    system: system as System,
    scenes: scenes === undefined ? null : [...(scenes as string[])],
    phase: (phase as SystemPhase | undefined) ?? "update",
    disabled,
    startsEnabled: startsEnabled !== false,
    onEnable: (onEnable as ((world: World) => void) | undefined) ?? null,
    onDisable: (onDisable as ((world: World) => void) | undefined) ?? null,
    exports,
  };
}

function readComponent(name: string, exports: Record<string, unknown>): LoadedComponent {
  const type = exports.default;
  if (typeof type !== "function") {
    throw new Error("A component script must `export default` a class");
  }
  try {
    new (type as new () => unknown)();
  } catch (error) {
    throw new Error(`The component class must work with \`new ${name}()\`: ${messageOf(error)}`);
  }
  const fields = exports.fields ?? {};
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    throw new Error('`export const fields` must be an object like { speed: "number" }');
  }
  const checked: Record<string, FieldKind> = {};
  for (const [field, kind] of Object.entries(fields)) {
    if (!isFieldKind(kind)) {
      throw new Error(
        `fields.${field} must be "number", "optionalNumber", "string", "boolean", "color", ` +
          `"image" or { choice: [...] }`,
      );
    }
    checked[field] = kind;
  }
  return { name, definition: component(type as new () => unknown, name, checked), exports };
}
