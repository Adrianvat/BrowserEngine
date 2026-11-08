import type { BuiltInSystem, ScriptKind } from "../engine";

/** Wraps a comment at 90 columns, one `// ` line per row. */
function comment(text: string): string[] {
  const lines: string[] = [];
  let line = "//";
  for (const word of text.split(" ")) {
    if (line.length + 1 + word.length > 90) {
      lines.push(line);
      line = "//";
    }
    line += ` ${word}`;
  }
  lines.push(line);
  return lines;
}

/** The code that adds one of the engine's systems to a project: a script re-exporting it. */
export function builtInSystemTemplate(system: BuiltInSystem, sceneNames: readonly string[]): string {
  const example = sceneNames[sceneNames.length - 1] ?? "play";
  return [
    `import { ${system.name} } from "engine";`,
    ``,
    `// Runs in every scene; to keep it to some, list them:`,
    `// export const scenes = ${JSON.stringify([example])};`,
    ``,
    ...comment(system.description),
    `export default ${system.name};`,
    ``,
  ].join("\n");
}

/** The code a new system starts with. `sceneNames` shows the user what they can pick. */
export function systemTemplate(name: string, sceneNames: readonly string[]): string {
  const example = sceneNames[sceneNames.length - 1] ?? "play";
  return [
    `import { Transform } from "engine";`,
    ``,
    `// Which scenes this system runs in; leave it out to run in every scene.`,
    `export const scenes = ${JSON.stringify([example])};`,
    ``,
    `/** Runs 60 times a second while the scene runs; dt is the step in seconds. */`,
    `export default function ${name}(world, dt) {`,
    `  for (const [entity, transform] of world.query(Transform)) {`,
    `    // transform.x += 10 * dt;`,
    `  }`,
    `}`,
    ``,
    `// When the system starts running (its scene was entered, after the entities were spawned,`,
    `// or it was enabled again) and when it stops (the scene is left, or it was disabled):`,
    `// export function onEnable(world) {}`,
    `// export function onDisable(world) {}`,
    `// Off until a script turns it on with world.getResource(Systems).enable("${name}"):`,
    `// export const startsEnabled = false;`,
    ``,
  ].join("\n");
}

/** The code a new component starts with. */
export function componentTemplate(name: string): string {
  return [
    `/** What this component means for an entity that has it. */`,
    `export default class ${name} {`,
    `  speed = 100;`,
    `}`,
    ``,
    `// The fields the scene editor shows and scene data can hold, with their kinds: "number",`,
    `// "optionalNumber", "string", "boolean", "color", "image" or { choice: ["a", "b"] }.`,
    `export const fields = { speed: "number" };`,
    ``,
  ].join("\n");
}

/** The code a new scene script starts with: the setup of the scene of that name. */
export function sceneTemplate(name: string): string {
  return [
    `import { Rect, Transform } from "engine";`,
    ``,
    `/** Runs once when the "${name}" scene starts, after its entities from the scene editor are spawned. */`,
    `export default function setup(scene) {`,
    `  const { world } = scene;`,
    `  // const e = world.spawn();`,
    `  // world.add(e, new Transform(100, 100));`,
    `  // world.add(e, new Rect(32, 32, "tomato"));`,
    `}`,
    ``,
  ].join("\n");
}

export function templateFor(kind: ScriptKind, name: string, sceneNames: readonly string[]): string {
  if (kind === "system") return systemTemplate(name, sceneNames);
  return kind === "component" ? componentTemplate(name) : sceneTemplate(name);
}
