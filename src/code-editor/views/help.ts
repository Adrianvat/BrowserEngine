import { renderHighlighted } from "./highlighted";

function section(title: string, ...content: (string | HTMLElement)[]): HTMLDetailsElement {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = title;
  details.append(summary, ...content);
  return details;
}

/** A code sample, colored like the editor. */
function code(lines: string[]): HTMLPreElement {
  const pre = document.createElement("pre");
  pre.className = "sample";
  renderHighlighted(pre, lines.join("\n"));
  return pre;
}

function para(...sentences: string[]): HTMLParagraphElement {
  const p = document.createElement("p");
  p.textContent = sentences.join(" ");
  return p;
}

/** How scripts are written, and what `"engine"` offers. */
export function mountHelp(
  root: HTMLElement,
  engineNames: readonly string[],
  sceneNames: readonly string[],
): void {
  const title = document.createElement("h2");
  title.textContent = "Help";

  const scenes = sceneNames.map((name) => JSON.stringify(name)).join(", ");

  const systems = section(
    "Writing a system",
    para(
      "A system is a JavaScript module whose default export is a function (world, dt).",
      "It runs 60 times a second, in the order of the Systems list, in the scenes it names.",
    ),
    code([
      `import { Transform, Velocity } from "engine";`,
      `import Player from "components/Player";`,
      ``,
      `export const scenes = [${scenes}]; // omit: every scene`,
      `// export const phase = "render"; // once per frame, after drawing`,
      ``,
      `export default function chase(world, dt) {`,
      `  for (const [entity, t, v] of world.query(Transform, Velocity)) {`,
      `    t.x += v.x * dt;`,
      `  }`,
      `}`,
    ]),
    para(
      "Other exports (constants, helpers) can be imported by other scripts.",
      "Disable (in a system's details) takes it out of the game without deleting its file;",
      "it waits under Not running until it is enabled again.",
    ),
    para(
      "A system can also react to starting and stopping, and be switched on and off while",
      "the game runs:",
    ),
    code([
      `export function onEnable(world) {}  // the scene was entered (entities spawned), or enabled again`,
      `export function onDisable(world) {} // the scene is left, the game stopped, or disabled`,
      `export const startsEnabled = false; // waits, off, until a script enables it`,
      ``,
      `// From any script, at once (the hooks run right then):`,
      `world.getResource(Systems).disable("playerInput");`,
      `world.getResource(Systems).enable("bossFight");`,
      `world.getResource(Systems).isEnabled("bossFight");`,
    ]),
  );

  const components = section(
    "Writing a component",
    para(
      "A component is a class: the default export. Instances are created with `new` and no",
      "arguments, so give every field a default. `fields` says which of them the scene",
      "editor shows and scene data can set.",
    ),
    code([
      `export default class Spin {`,
      `  speed = 90;`,
      `  direction = "left";`,
      `}`,
      ``,
      `export const fields = {`,
      `  speed: "number",`,
      `  direction: { choice: ["left", "right"] },`,
      `};`,
    ]),
    para(
      'Field kinds: "number", "optionalNumber", "string", "boolean", "color", "image", or',
      "{ choice: [...] }. The script's name is the component's name in scene data.",
    ),
  );

  const sceneSetups = section(
    "Writing a scene setup",
    para(
      "A scene setup is a module named after one of the project's scenes (add scenes in the",
      "scene editor) whose default export runs once when that scene starts, after the",
      "entities from the scene editor are spawned: for what can't be drawn in the editor,",
      "like things placed at random. Without one, a scene is just its entities.",
    ),
    code([
      `import { Circle, Transform } from "engine";`,
      ``,
      `export default function setup(scene) {`,
      `  const { world } = scene;`,
      `  const e = world.spawn();`,
      `  world.add(e, new Transform(Math.random() * 800, 100));`,
      `  world.add(e, new Circle(8, "gold"));`,
      `}`,
    ]),
    para(
      "Values a script exports live as long as the game page, so a scene setup can keep a",
      "score or a counter for the other scenes to import.",
    ),
  );

  const imports = section(
    "Imports and saving",
    para(
      'Scripts import the engine as "engine" and each other as "systems/<name>",',
      '"components/<name>" or "scenes/<name>" (static imports at the top; a full https:// URL also works).',
      "Each script is a file in the project's scripts folder (systems/, components/, scenes/,",
      "and order.json for the systems' order). Saving (Ctrl+S) writes the file through the dev",
      "server; the game page and the scene editor reload with it, and git carries it to other",
      "machines. Files changed with another editor show up here as well.",
    ),
    para(
      "Every keystroke is checked by loading the scripts the way the game does; a problem",
      "shows on the script in the list and under Check. Syntax errors name the problem but",
      "not always the line: the browser console has it.",
    ),
    para(
      "While typing, names pop up: keywords, what \"engine\" exports, members of its",
      "classes, names used in the scripts, and script paths inside an import. Up/Down",
      "choose, Enter or Tab accepts, Escape dismisses; Ctrl+Space asks for them.",
    ),
  );

  const world = section(
    "Using the World",
    code([
      `world.query(A, B)            // [entity, a, b][] with all of them`,
      `world.get(entity, A)         // the component or undefined`,
      `world.has(entity, A)`,
      `world.add(entity, new A())`,
      `world.remove(entity, A)`,
      `world.spawn() / world.despawn(entity) / world.isAlive(entity)`,
      `world.getResource(Keyboard)  // Keyboard, Canvas, Assets, Scenes, Systems,`,
      `                             // Contacts, Gravity, CollisionLayers, PerfStats`,
      `findByName(world, "Player")  // the entity named so in the scene editor`,
      `world.getResource(Scenes).switchTo("play")`,
    ]),
  );

  const list = document.createElement("p");
  list.className = "names";
  list.textContent = [...engineNames].sort((a, b) => a.localeCompare(b)).join(", ");
  const engine = section('What "engine" exports', list);

  root.replaceChildren(title, systems, components, sceneSetups, imports, world, engine);
}
