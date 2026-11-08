// With its extension: Vite's config loads this file through the dev-server plugin (tools/).
import { isScriptName, type Script, type ScriptKind } from "./script.ts";

/**
 * Scripts are files: `systems/<name>.js`, `components/<Name>.js` and `scenes/<name>.js`
 * under the project's scripts folder, with `order.json` listing the systems in the order
 * they run. This module turns such files into the script list; the dev server and the
 * bundled game both use it, so they agree on what the scripts are.
 */
export const ORDER_FILE = "order.json";

/**
 * The contents of order.json. Systems not listed in `systems` run after the listed ones,
 * by name. Systems in `disabled` keep their file and their place, but the game does not
 * run them, so one can be switched off and on again without losing its code.
 */
export interface ScriptOrder {
  systems: string[];
  disabled: string[];
}

/** The script a file path (relative, e.g. "./systems/kick.js" or "systems/kick.js") names. */
export function scriptFromFile(path: string): { kind: ScriptKind; name: string } | null {
  const match = /(?:^|\/)(system|component|scene)s\/([^/]+)\.js$/.exec(path);
  if (!match || !isScriptName(match[2])) return null;
  return { kind: match[1] as ScriptKind, name: match[2] };
}

/** The file path of a script, relative to the scripts folder. */
export function scriptFile(kind: ScriptKind, name: string): string {
  return `${kind}s/${name}.js`;
}

/** The script names in a list, leniently: anything else is skipped, as are repeats. */
function scriptNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const name of value) {
    if (typeof name === "string" && isScriptName(name) && !names.includes(name)) names.push(name);
  }
  return names;
}

/** An order file's contents, leniently: what is missing or broken counts as empty. */
export function parseScriptOrder(value: unknown): ScriptOrder {
  if (typeof value !== "object" || value === null) return { systems: [], disabled: [] };
  const { systems, disabled } = value as { systems?: unknown; disabled?: unknown };
  return { systems: scriptNames(systems), disabled: scriptNames(disabled) };
}

/**
 * The script list for a set of files (path -> code): the systems in `order` first (the
 * disabled ones marked so), the other systems after them by name, then the components
 * by name, then the scenes by name. Files that are not scripts are ignored.
 */
export function arrangeScripts(files: Record<string, string>, order: ScriptOrder): Script[] {
  const byKind = { system: new Map<string, string>(), component: new Map<string, string>(), scene: new Map<string, string>() };
  for (const [path, code] of Object.entries(files)) {
    const script = scriptFromFile(path);
    if (script) byKind[script.kind].set(script.name, code);
  }
  const byName = (a: string, b: string) => a.localeCompare(b);
  const systems = byKind.system;
  const orderedSystems = [
    ...order.systems.filter((name) => systems.has(name)),
    ...[...systems.keys()].filter((name) => !order.systems.includes(name)).sort(byName),
  ];
  const sorted = (kind: "component" | "scene"): Script[] =>
    [...byKind[kind].keys()].sort(byName).map((name) => ({ kind, name, code: byKind[kind].get(name)! }));
  return [
    ...orderedSystems.map((name): Script => {
      const script: Script = { kind: "system", name, code: systems.get(name)! };
      if (order.disabled.includes(name)) script.disabled = true;
      return script;
    }),
    ...sorted("component"),
    ...sorted("scene"),
  ];
}
