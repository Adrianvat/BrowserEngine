/**
 * A script is one piece of game logic written in the code editor: the source of an ES
 * module that defines a system, a component, or a scene's setup. Scripts are plain
 * JavaScript, loaded by the browser at runtime, so they can be edited without a build step.
 */
export type ScriptKind = "system" | "component" | "scene";

export const SCRIPT_KINDS: readonly ScriptKind[] = ["system", "component", "scene"];

export interface Script {
  kind: ScriptKind;
  /** An identifier: a component's registered name, what a system is listed as, or a scene's name. */
  name: string;
  /** The module's source code. */
  code: string;
  /** A system switched off: its file is kept, but the game does not run it. */
  disabled?: boolean;
}

/** The saved form of the game's scripts, in system order. */
export interface ScriptSet {
  version: 1;
  scripts: Script[];
}

/** What a script imports the engine as: `import { World } from "engine"`. */
export const ENGINE_SPECIFIER = "engine";

const NAME = /^[A-Za-z_$][\w$]*$/;

/** Whether `name` can name a script: a JavaScript identifier. */
export function isScriptName(name: string): boolean {
  return NAME.test(name);
}

/** The path one script imports another by: "systems/kick", "components/Player", "scenes/play". */
export function scriptPath(kind: ScriptKind, name: string): string {
  return `${kind}s/${name}`;
}

/** The script a path names, or null when it is not a script path. */
export function parseScriptPath(path: string): { kind: ScriptKind; name: string } | null {
  const match = /^(system|component|scene)s\/(.+)$/.exec(path);
  if (!match || !isScriptName(match[2])) return null;
  return { kind: match[1] as ScriptKind, name: match[2] };
}

export function isScriptKind(value: unknown): value is ScriptKind {
  return (SCRIPT_KINDS as readonly unknown[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks a saved script set and returns a fresh copy of its scripts. */
export function validateScripts(value: unknown): Script[] {
  if (!isObject(value) || !("version" in value) || !Array.isArray(value.scripts)) {
    throw new Error('Saved scripts must be an object with "version" and "scripts"');
  }
  if (value.version !== 1) {
    throw new Error(`Unsupported scripts version: ${String(value.version)}`);
  }
  const seen = new Set<string>();
  return value.scripts.map((entry, index) => {
    if (!isObject(entry) || !isScriptKind(entry.kind)) {
      throw new Error(`Script ${index} must have a "kind" of system, component or scene`);
    }
    if (typeof entry.name !== "string" || !isScriptName(entry.name)) {
      throw new Error(`Script ${index} must have an identifier as its "name"`);
    }
    if (typeof entry.code !== "string") {
      throw new Error(`Script ${index} ("${entry.name}") must have its "code" as a string`);
    }
    const path = scriptPath(entry.kind, entry.name);
    if (seen.has(path)) throw new Error(`Script "${path}" appears twice`);
    seen.add(path);
    const script: Script = { kind: entry.kind, name: entry.name, code: entry.code };
    if (entry.disabled === true && entry.kind === "system") script.disabled = true;
    return script;
  });
}

/** Parses saved scripts (JSON text). */
export function parseScripts(text: string): Script[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Saved scripts are not valid JSON: ${reason}`);
  }
  return validateScripts(value);
}

/** One static import in a script's code: the specifier and where it sits (without quotes). */
export interface ImportSpec {
  specifier: string;
  start: number;
  end: number;
}

// Static imports and re-exports only: `import x from "..."`, `import { a } from "..."`,
// `export { a } from "..."` and `import "..."`, each starting its own line. Between the
// keyword and `from` only names, braces, commas and `*` can appear, so a `from "..."`
// inside a function body or a string is never taken for an import.
const FROM_IMPORT = /^[ \t]*(?:import|export)\b[\w\s{},*$]*?\bfrom\s*(["'])([^"'\n]*)\1/gm;
const BARE_IMPORT = /^[ \t]*import\s*(["'])([^"'\n]*)\1/gm;

/** The static imports in a script's code, in source order. */
export function findImports(code: string): ImportSpec[] {
  const found: ImportSpec[] = [];
  for (const pattern of [FROM_IMPORT, BARE_IMPORT]) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[2];
      const end = match.index + match[0].length - 1; // before the closing quote
      found.push({ specifier, start: end - specifier.length, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** The same code with every static import's specifier replaced by `resolve(specifier)`. */
export function rewriteImports(code: string, resolve: (specifier: string) => string): string {
  let result = code;
  // Back to front, so earlier positions stay valid.
  for (const spec of findImports(code).reverse()) {
    result = result.slice(0, spec.start) + resolve(spec.specifier) + result.slice(spec.end);
  }
  return result;
}

/** Whether a specifier is left alone: a full URL, e.g. a module from a CDN. */
export function isUrlSpecifier(specifier: string): boolean {
  return /^https?:\/\//.test(specifier);
}

export interface ScriptError {
  kind: ScriptKind;
  name: string;
  message: string;
}

/** A script's place in the load order, with the scripts it imports. */
export interface PlannedScript {
  script: Script;
  /** Paths of the scripts this one imports, in import order. */
  dependencies: string[];
}

export interface LoadPlan {
  /** Every loadable script, each after the scripts it imports. */
  order: PlannedScript[];
  /** Scripts that can't be loaded: an unknown import, or a circle of imports. */
  errors: ScriptError[];
}

/**
 * Works out the order to load scripts in, so that each one comes after what it imports.
 * Scripts with an unknown import, in a circle of imports, or importing a script with
 * either problem are reported instead of ordered.
 */
export function planLoad(scripts: readonly Script[]): LoadPlan {
  const byPath = new Map<string, Script>();
  for (const script of scripts) byPath.set(scriptPath(script.kind, script.name), script);

  const failed = new Map<string, string>();
  const dependenciesOf = new Map<string, string[]>();
  for (const script of scripts) {
    const path = scriptPath(script.kind, script.name);
    const dependencies: string[] = [];
    for (const { specifier } of findImports(script.code)) {
      if (specifier === ENGINE_SPECIFIER || isUrlSpecifier(specifier)) continue;
      if (!byPath.has(specifier)) {
        failed.set(
          path,
          parseScriptPath(specifier)
            ? `There is no script "${specifier}" to import`
            : `Can't import "${specifier}": scripts can import "engine" or another script, ` +
              `e.g. "components/Player"`,
        );
        break;
      }
      if (!dependencies.includes(specifier)) dependencies.push(specifier);
    }
    dependenciesOf.set(path, dependencies);
  }

  const order: PlannedScript[] = [];
  const done = new Set<string>();
  const visiting: string[] = [];
  const visit = (path: string): void => {
    if (done.has(path) || failed.has(path)) return;
    const cycleStart = visiting.indexOf(path);
    if (cycleStart >= 0) {
      const circle = [...visiting.slice(cycleStart), path];
      for (const member of circle) {
        failed.set(member, `Scripts import each other in a circle: ${circle.join(" -> ")}`);
      }
      return;
    }
    visiting.push(path);
    const dependencies = dependenciesOf.get(path) ?? [];
    for (const dependency of dependencies) visit(dependency);
    visiting.pop();
    if (failed.has(path)) return;
    const broken = dependencies.find((dependency) => failed.has(dependency));
    if (broken !== undefined) {
      failed.set(path, `Can't load because "${broken}" failed`);
      return;
    }
    done.add(path);
    order.push({ script: byPath.get(path)!, dependencies });
  };
  for (const path of byPath.keys()) visit(path);

  const errors: ScriptError[] = [];
  for (const script of scripts) {
    const message = failed.get(scriptPath(script.kind, script.name));
    if (message !== undefined) errors.push({ kind: script.kind, name: script.name, message });
  }
  return { order, errors };
}
