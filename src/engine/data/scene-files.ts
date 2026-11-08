// With its extension: Vite's config loads this file through the dev-server plugin (tools/).
import type { EntityData, SceneData } from "./scene-data.ts";

/**
 * Scenes' starting entities are files: `<name>.json` in the project's scenes folder, next to
 * the scene's code. The dev server serves and writes them for the scene editor, and the
 * bundled game reads them through this module, so they agree on what the scenes are.
 */

/** One scene's file: its data as JSON text, read from disk or bundled with the page. */
export interface SceneFile {
  name: string;
  text: string;
}

const NAME = /^[A-Za-z0-9][\w-]*$/;

/** Whether `name` can name a scene file: letters, digits, `_` and `-`. */
export function isSceneName(name: string): boolean {
  return NAME.test(name);
}

/** The file of a scene, relative to the scenes folder. */
export function sceneFile(name: string): string {
  return `${name}.json`;
}

/** The scene a file path (e.g. "./play.json" or "play.json") names, or null for other files. */
export function sceneFromFile(path: string): string | null {
  const match = /(?:^|\/)([^/]+)\.json$/.exec(path);
  return match && isSceneName(match[1]) ? match[1] : null;
}

/** The scene files among a set of files (path -> text), by name. Other files are ignored. */
export function collectSceneFiles(files: Record<string, string>): SceneFile[] {
  const scenes: SceneFile[] = [];
  for (const [path, text] of Object.entries(files)) {
    const name = sceneFromFile(path);
    if (name !== null) scenes.push({ name, text });
  }
  return scenes.sort((a, b) => a.name.localeCompare(b.name));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks the shape of scene data (the version, entities with a name and components with
 * field objects), without knowing the components, and returns a fresh copy. The dev
 * server checks this much before writing a scene file; validateSceneData checks the rest.
 */
export function validateSceneShape(value: unknown): SceneData {
  if (!isObject(value) || !("version" in value) || !Array.isArray(value.entities)) {
    throw new Error('Scene data must be an object with "version" and "entities"');
  }
  if (value.version !== 1) {
    throw new Error(`Unsupported scene data version: ${String(value.version)}`);
  }
  return { version: 1, entities: value.entities.map(validateEntityShape) };
}

function validateEntityShape(entity: unknown, index: number): EntityData {
  if (!isObject(entity) || typeof entity.name !== "string" || !isObject(entity.components)) {
    throw new Error(`Entity ${index} must have a "name" string and a "components" object`);
  }
  const components: Record<string, Record<string, unknown>> = {};
  for (const [componentName, fields] of Object.entries(entity.components)) {
    if (!isObject(fields)) {
      throw new Error(
        `Entity ${index} ("${entity.name}"): ${componentName} must be an object of field values`,
      );
    }
    components[componentName] = { ...fields };
  }
  return { name: entity.name, components };
}

/** A component's line is kept to this width; longer ones get a line per field. */
const LINE_WIDTH = 120;

/**
 * Scene data as it is written to its file: one line per component (a line per field for
 * a long one), so a change to one entity is a small diff in version control.
 */
export function formatSceneData(data: SceneData): string {
  const entities = data.entities.map((entity) => {
    const components = Object.entries(entity.components).map(
      ([name, fields]) => `        ${JSON.stringify(name)}: ${formatFields(fields, name)}`,
    );
    const componentsText = components.length === 0 ? "{}" : `{\n${components.join(",\n")}\n      }`;
    return `    {\n      "name": ${JSON.stringify(entity.name)},\n      "components": ${componentsText}\n    }`;
  });
  const entitiesText = entities.length === 0 ? "[]" : `[\n${entities.join(",\n")}\n  ]`;
  return `{\n  "version": ${data.version},\n  "entities": ${entitiesText}\n}\n`;
}

/** `{ "x": 0, "y": 0 }`, or `{}`, or one field per line when the line would be too long. */
function formatFields(fields: Record<string, unknown>, name: string): string {
  const entries = Object.entries(fields).map(
    ([field, value]) => `${JSON.stringify(field)}: ${JSON.stringify(value)}`,
  );
  if (entries.length === 0) return "{}";
  const inline = `{ ${entries.join(", ")} }`;
  // The line as written: indent, name, the fields and a trailing comma.
  if (8 + JSON.stringify(name).length + 2 + inline.length + 1 <= LINE_WIDTH) return inline;
  return `{\n${entries.map((entry) => `          ${entry}`).join(",\n")}\n        }`;
}
