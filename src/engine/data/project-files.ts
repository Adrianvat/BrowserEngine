// With its extension: Vite's config loads this file through the dev-server plugin (tools/).
import type { LayerRules } from "../physics/layers.ts";

/**
 * A project is a game: a folder holding `project.json` (this module's settings), its
 * scripts (`scripts/`), its scenes' entities (`scenes/*.json`) and its images
 * (`images/`). Everything in it is data or JavaScript, so a project can be made and
 * edited in the editors without a build. The dev server serves and writes the folders
 * for the editors, and the bundled game reads them, so they agree on what a project is.
 */
export const PROJECT_FILE = "project.json";

/** What `project.json` holds: the game's settings and its scene list. */
export interface ProjectSettings {
  /** Shown in the editors; the folder name (the project id) when empty. */
  name: string;
  width: number;
  height: number;
  /** Turn off image smoothing so scaled-up pixel art stays sharp. */
  pixelArt: boolean;
  /** What every Body feels, in pixels per second squared; positive y is down. */
  gravity: { x: number; y: number };
  /** How Collider layers interact (see GameOptions.collisionLayers). */
  collisionLayers: Record<string, LayerRules>;
  /** The scenes, in the order the editor lists them. */
  scenes: string[];
  /** The scene the game starts in; one of `scenes`. */
  firstScene: string;
}

/** A project's settings file, as read from disk or bundled with the page. */
export interface ProjectFile {
  id: string;
  text: string;
}

const ID = /^[A-Za-z0-9][\w-]*$/;

/** Whether `id` can name a project folder: letters, digits, `_` and `-`. */
export function isProjectId(id: string): boolean {
  return ID.test(id);
}

/** The project a path (e.g. "/projects/demo/scenes/play.json") is in, and the path inside it. */
export function projectFromPath(path: string): { id: string; file: string } | null {
  const match = /(?:^|\/)projects\/([^/]+)\/(.+)$/.exec(path);
  return match && isProjectId(match[1]) ? { id: match[1], file: match[2] } : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Checks settings (parsed JSON) and returns a fresh copy with the optional parts filled in. */
export function validateProjectSettings(value: unknown): ProjectSettings {
  if (!isObject(value)) throw new Error("Project settings must be an object");
  const { name = "", width, height, pixelArt = false, gravity = {}, collisionLayers = {} } = value;
  const { scenes, firstScene } = value;
  if (typeof name !== "string") throw new Error('"name" must be a string');
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new Error('"width" and "height" must be positive whole numbers');
  }
  if (typeof pixelArt !== "boolean") throw new Error('"pixelArt" must be true or false');
  if (!isObject(gravity)) throw new Error('"gravity" must be an object like { "y": 980 }');
  const { x = 0, y = 0 } = gravity;
  if (!isNumber(x) || !isNumber(y)) throw new Error('"gravity" must have numbers for "x" and "y"');
  if (!isObject(collisionLayers)) throw new Error('"collisionLayers" must be an object of layers');
  const layers: Record<string, LayerRules> = {};
  for (const [layer, rules] of Object.entries(collisionLayers)) {
    if (!isObject(rules)) throw new Error(`Layer "${layer}" must be an object with "solid" and "touch" lists`);
    const { solid, touch } = rules;
    if ((solid !== undefined && !isStringList(solid)) || (touch !== undefined && !isStringList(touch))) {
      throw new Error(`Layer "${layer}": "solid" and "touch" must be lists of layer names`);
    }
    layers[layer] = {};
    if (solid) layers[layer].solid = [...solid];
    if (touch) layers[layer].touch = [...touch];
  }
  if (!isStringList(scenes) || new Set(scenes).size !== scenes.length) {
    throw new Error('"scenes" must be a list of scene names, each once');
  }
  if (scenes.length > 0 && (typeof firstScene !== "string" || !scenes.includes(firstScene))) {
    throw new Error('"firstScene" must be one of the scenes');
  }
  return {
    name,
    width,
    height,
    pixelArt,
    gravity: { x, y },
    collisionLayers: layers,
    scenes: [...scenes],
    firstScene: scenes.length === 0 ? "" : (firstScene as string),
  };
}

/** Parses a project settings file's text. */
export function parseProjectSettings(text: string): ProjectSettings {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateProjectSettings(value);
}

/** The settings a new project starts with: one empty scene, gravity on. */
export function newProjectSettings(name: string): ProjectSettings {
  return {
    name,
    width: 800,
    height: 600,
    pixelArt: true,
    gravity: { x: 0, y: 980 },
    collisionLayers: {},
    scenes: ["main"],
    firstScene: "main",
  };
}

/** `["a", "b"]` */
function list(names: readonly string[]): string {
  return `[${names.map((name) => JSON.stringify(name)).join(", ")}]`;
}

/** Settings as they are written to project.json: one line per setting and per layer. */
export function formatProjectSettings(settings: ProjectSettings): string {
  const layers = Object.entries(settings.collisionLayers).map(([layer, rules]) => {
    const parts = [];
    if (rules.solid) parts.push(`"solid": ${list(rules.solid)}`);
    if (rules.touch) parts.push(`"touch": ${list(rules.touch)}`);
    return `    ${JSON.stringify(layer)}: ${parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`}`;
  });
  const layersText = layers.length === 0 ? "{}" : `{\n${layers.join(",\n")}\n  }`;
  return [
    "{",
    `  "name": ${JSON.stringify(settings.name)},`,
    `  "width": ${settings.width},`,
    `  "height": ${settings.height},`,
    `  "pixelArt": ${settings.pixelArt},`,
    `  "gravity": { "x": ${JSON.stringify(settings.gravity.x)}, "y": ${JSON.stringify(settings.gravity.y)} },`,
    `  "collisionLayers": ${layersText},`,
    `  "scenes": ${list(settings.scenes)},`,
    `  "firstScene": ${JSON.stringify(settings.firstScene)}`,
    "}",
    "",
  ].join("\n");
}
