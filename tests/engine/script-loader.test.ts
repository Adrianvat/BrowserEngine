import { describe, it, expect } from "vitest";
import * as engine from "../../src/engine";
import {
  component,
  dataUrlHost,
  describeScriptErrors,
  loadScripts,
  Transform,
  Velocity,
  World,
  type LoadOptions,
  type ModuleHost,
  type Script,
} from "../../src/engine";

function system(name: string, code: string): Script {
  return { kind: "system", name, code };
}
function comp(name: string, code: string): Script {
  return { kind: "component", name, code };
}
function sceneScript(name: string, code: string): Script {
  return { kind: "scene", name, code };
}

function load(scripts: Script[], options: Partial<LoadOptions> = {}) {
  return loadScripts(scripts, { engine, host: dataUrlHost, ...options });
}

describe("loadScripts", () => {
  it("loads a system that uses the engine, with its scenes and phase", async () => {
    const result = await load([
      system(
        "drift",
        [
          `import { Transform, Velocity } from "engine";`,
          `export const scenes = ["play"];`,
          `export const SPEED = 5;`,
          `export default function drift(world, dt) {`,
          `  for (const [, t, v] of world.query(Transform, Velocity)) { t.x += v.x * dt; }`,
          `}`,
        ].join("\n"),
      ),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.components).toEqual([]);
    const [drift] = result.systems;
    expect(drift.name).toBe("drift");
    expect(drift.scenes).toEqual(["play"]);
    expect(drift.phase).toBe("update");
    expect(drift.exports.SPEED).toBe(5);

    // The script's Transform is the engine's own class, so it works on a real World.
    const world = new World();
    const e = world.spawn();
    world.add(e, new Transform(0, 0));
    world.add(e, new Velocity(10, 0));
    drift.system(world, 0.5);
    expect(world.get(e, Transform)!.x).toBe(5);
  });

  it("loads a scene script as that scene's setup, which other scripts can import from", async () => {
    const result = await load(
      [
        sceneScript("title", `import { plays } from "scenes/play";\nexport default (scene) => { scene.world.spawn(); plays.count++; };`),
        sceneScript("play", `export const plays = { count: 0 };\nexport default function setup() {}`),
      ],
      { sceneNames: ["title", "play"] },
    );
    expect(result.errors).toEqual([]);
    expect(result.scenes.map((scene) => scene.name)).toEqual(["title", "play"]);
    const world = new World();
    const systems: unknown[] = [];
    result.scenes[0].scene.setup({ world, addSystem: (s) => systems.push(s), addRenderSystem: () => {} });
    expect(world.entityCount).toBe(1);
    expect((result.scenes[1].exports.plays as { count: number }).count).toBe(1);
  });

  it("reports a scene script that is not a function, or for a scene that does not exist", async () => {
    const bad = await load([sceneScript("play", `export default 5;`)], { sceneNames: ["play"] });
    expect(bad.errors).toEqual([
      { kind: "scene", name: "play", message: "A scene script must `export default` a function (scene) => void, its setup" },
    ]);
    expect(bad.scenes).toEqual([]);
    const unknown = await load([sceneScript("bonus", `export default () => {};`)], { sceneNames: ["play"] });
    expect(unknown.errors[0]).toMatchObject({ kind: "scene", name: "bonus" });
    expect(unknown.errors[0].message).toContain('There is no scene "bonus"');
    expect(unknown.scenes).toEqual([]);
    const unchecked = await load([sceneScript("bonus", `export default () => {};`)]);
    expect(unchecked.errors).toEqual([]);
    expect(unchecked.scenes).toHaveLength(1);
  });

  it("reads a system's starting switch and its onEnable/onDisable, and checks them", async () => {
    const result = await load([
      system(
        "boss",
        [
          `export const startsEnabled = false;`,
          `export function onEnable(world) { world.spawn(); }`,
          `export const onDisable = () => {};`,
          `export default () => {};`,
        ].join("\n"),
      ),
      system("plain", `export default () => {};`),
    ]);
    expect(result.errors).toEqual([]);
    const [boss, plain] = result.systems;
    expect(boss.startsEnabled).toBe(false);
    const world = new World();
    boss.onEnable!(world);
    expect(world.entityCount).toBe(1);
    expect(typeof boss.onDisable).toBe("function");
    expect(plain).toMatchObject({ startsEnabled: true, onEnable: null, onDisable: null });

    const bad = await load([
      system("a", `export const startsEnabled = "no";\nexport default () => {};`),
      system("b", `export const onEnable = 5;\nexport default () => {};`),
      system("c", `export function onDisable() {}\nexport const onEnable = () => {};\nexport default 3;`),
    ]);
    expect(bad.errors.map((e) => e.message)).toEqual([
      "`export const startsEnabled` must be true or false",
      "`export function onEnable(world)` must be a function",
      "A system script must `export default` a function (world, dt) => void",
    ]);
  });

  it("loads and checks a disabled system too, marking it so", async () => {
    const result = await load([{ ...system("off", `export default () => {};`), disabled: true }, system("on", `export default () => {};`)]);
    expect(result.errors).toEqual([]);
    expect(result.systems.map((s) => [s.name, s.disabled])).toEqual([["off", true], ["on", false]]);
  });

  it("defaults a system to every scene and the update phase; accepts the render phase", async () => {
    const result = await load([
      system("a", `export default () => {};`),
      system("b", `export default () => {};\nexport const phase = "render";`),
    ]);
    expect(result.systems.map((s) => [s.scenes, s.phase])).toEqual([
      [null, "update"],
      [null, "render"],
    ]);
  });

  it("loads a component with its fields, registered under the script's name", async () => {
    const result = await load([
      comp(
        "Spin",
        `export default class Spinner { speed = 90; clockwise = true; }\nexport const fields = { speed: "number", clockwise: "boolean" };`,
      ),
    ]);
    expect(result.errors).toEqual([]);
    const [spin] = result.components;
    expect(spin.name).toBe("Spin");
    expect(spin.definition.name).toBe("Spin");
    expect(spin.definition.fields).toEqual({ speed: "number", clockwise: "boolean" });
    const instance = new (spin.definition.type as new () => { speed: number })();
    expect(instance.speed).toBe(90);
  });

  it("a component without fields is a tag", async () => {
    const result = await load([comp("Player", `export default class Player {}`)]);
    expect(result.components[0].definition.fields).toEqual({});
  });

  it("lets a system import a component and other systems", async () => {
    const result = await load([
      system(
        "follow",
        `import Player from "components/Player";\nimport { RANGE } from "systems/shared";\nexport default (world) => world.query(Player).length * RANGE;`,
      ),
      system("shared", `export const RANGE = 3;\nexport default () => {};`),
      comp("Player", `export default class Player {}`),
    ]);
    expect(result.errors).toEqual([]);
    const world = new World();
    const e = world.spawn();
    world.add(e, new (result.components[0].definition.type as new () => object)());
    const follow = result.systems.find((s) => s.name === "follow")!;
    expect(follow.system(world, 0)).toBe(3);
    // Systems keep script order, whatever order they loaded in.
    expect(result.systems.map((s) => s.name)).toEqual(["follow", "shared"]);
  });

  it("evaluates scripts afresh on every load", async () => {
    const scripts = [system("count", `export let n = 0; n++;\nexport default () => {};`)];
    const first = await load(scripts);
    const second = await load(scripts);
    expect(first.systems[0].exports).not.toBe(second.systems[0].exports);
    expect(second.systems[0].exports.n).toBe(1);
  });

  it("cleans up the global handle it uses to pass the engine in", async () => {
    await load([system("a", `import { World } from "engine";\nexport default () => {};`)]);
    const handles = (globalThis as Record<string, unknown>)["browser-engine:scripting"];
    expect(handles).toEqual({});
  });

  describe("errors", () => {
    it("reports a syntax error and keeps loading the other scripts", async () => {
      const result = await load([
        system("broken", `export default function ( {`),
        system("fine", `export default () => {};`),
      ]);
      expect(result.systems.map((s) => s.name)).toEqual(["fine"]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ kind: "system", name: "broken" });
      expect(result.errors[0].message).toMatch(/^SyntaxError: /);
    });

    it("reports an error thrown while a script's top level runs", async () => {
      const result = await load([system("boom", `throw new Error("no good");\nexport default () => {};`)]);
      expect(result.errors[0].message).toBe("Error: no good");
    });

    it("reports a system without a default function", async () => {
      const result = await load([
        system("none", `export const x = 1;`),
        system("notFn", `export default 5;`),
      ]);
      expect(result.errors.map((e) => e.message)).toEqual([
        "A system script must `export default` a function (world, dt) => void",
        "A system script must `export default` a function (world, dt) => void",
      ]);
    });

    it("reports bad scenes and phase exports", async () => {
      const result = await load([
        system("a", `export default () => {};\nexport const scenes = "play";`),
        system("b", `export default () => {};\nexport const scenes = [1];`),
        system("c", `export default () => {};\nexport const phase = "later";`),
      ]);
      expect(result.errors.map((e) => e.message)).toEqual([
        '`export const scenes` must be an array of scene names, e.g. ["play"]',
        '`export const scenes` must be an array of scene names, e.g. ["play"]',
        '`export const phase` must be "update" or "render"',
      ]);
    });

    it("reports a component that is not a class that works without arguments", async () => {
      const result = await load([
        comp("A", `export default 1;`),
        comp("B", `export default () => {};`),
        comp("C", `export default class C { constructor(x) { if (x === undefined) throw new Error("need x"); } }`),
      ]);
      expect(result.errors.map((e) => e.message)).toEqual([
        "A component script must `export default` a class",
        expect.stringContaining("must work with `new B()`"),
        expect.stringContaining("must work with `new C()`: Error: need x"),
      ]);
    });

    it("reports bad fields", async () => {
      const result = await load([
        comp("A", `export default class A {}\nexport const fields = ["speed"];`),
        comp("B", `export default class B {}\nexport const fields = { speed: "float" };`),
        comp("C", `export default class C {}\nexport const fields = { mode: { choice: [] } };`),
      ]);
      expect(result.errors.map((e) => e.message)).toEqual([
        '`export const fields` must be an object like { speed: "number" }',
        expect.stringContaining("fields.speed must be"),
        expect.stringContaining("fields.mode must be"),
      ]);
    });

    it("reports a script importing one that failed, and unknown imports", async () => {
      const result = await load([
        system("user", `import P from "components/P";\nexport default () => {};`),
        comp("P", `export default 1;`),
        system("lost", `import X from "components/X";\nexport default () => {};`),
      ]);
      expect(result.systems).toEqual([]);
      expect(result.errors).toEqual([
        { kind: "system", name: "lost", message: 'There is no script "components/X" to import' },
        { kind: "component", name: "P", message: "A component script must `export default` a class" },
        { kind: "system", name: "user", message: 'Can\'t load because "components/P" failed' },
      ]);
    });

    it("checks scene names when asked", async () => {
      const result = await load(
        [
          system("a", `export default () => {};\nexport const scenes = ["play", "bonus"];`),
          system("b", `export default () => {};`),
        ],
        { sceneNames: ["title", "play"] },
      );
      expect(result.systems.map((s) => s.name)).toEqual(["b"]);
      expect(result.errors).toEqual([
        {
          kind: "system",
          name: "a",
          message: 'There is no scene "bonus" (the scenes are title, play)',
        },
      ]);
    });

    it("rejects a component named like one defined in code or built in", async () => {
      class Player {}
      const result = await load(
        [
          comp("Player", `export default class Player {}`),
          comp("Transform", `export default class Transform {}`),
          comp("Fine", `export default class Fine {}`),
        ],
        { fixedComponents: [component(Player, "Player", {})] },
      );
      expect(result.components.map((c) => c.name)).toEqual(["Fine"]);
      expect(result.errors.map((e) => e.name)).toEqual(["Player", "Transform"]);
      expect(result.errors[0].message).toContain('"Player" is already a component');
    });

    it("does not check component names without fixedComponents", async () => {
      const result = await load([comp("Transform", `export default class Transform {}`)]);
      expect(result.errors).toEqual([]);
    });

    it("describeScriptErrors lists them by path", () => {
      expect(
        describeScriptErrors([
          { kind: "system", name: "a", message: "one" },
          { kind: "component", name: "B", message: "two" },
        ]),
      ).toBe("systems/a: one\ncomponents/B: two");
    });
  });

  describe("module host", () => {
    it("labels modules, releases every URL afterwards, and leaves URL imports alone", async () => {
      const created: string[] = [];
      const released: string[] = [];
      const host: ModuleHost = {
        createUrl(code, name) {
          created.push(name);
          return dataUrlHost.createUrl(code, name);
        },
        importModule: dataUrlHost.importModule,
        releaseUrl: (url) => released.push(url),
      };
      const result = await load(
        [
          comp("P", `export default class P {}`),
          system("s", `import P from "components/P";\nexport default () => {};`),
        ],
        { host },
      );
      expect(result.errors).toEqual([]);
      expect(created).toEqual(["engine", "components/P", "systems/s"]);
      expect(released).toHaveLength(3);
    });

    it("passes a URL import through unchanged", async () => {
      let rewritten = "";
      const host: ModuleHost = {
        createUrl(code, name) {
          if (name === "systems/s") rewritten = code;
          return dataUrlHost.createUrl(code, name);
        },
        importModule: async () => ({ default: () => {} }),
      };
      await load([system("s", `import x from "https://cdn.example/x.js";\nexport default () => {};`)], {
        host,
      });
      expect(rewritten).toContain(`from "https://cdn.example/x.js"`);
      expect(rewritten).toContain("//# sourceURL=browser-engine/systems/s.js");
    });
  });
});
