import { describe, it, expect } from "vitest";
import {
  runsIn,
  scenesFromScripts,
  withScriptSystems,
  World,
  type LoadedScene,
  type LoadedSystem,
  type Scene,
  type System,
  type SystemLike,
} from "../../src/engine";

function loaded(name: string, scenes: string[] | null, phase: "update" | "render" = "update"): LoadedSystem {
  const system: System = () => {};
  return { name, system, scenes, phase, disabled: false, startsEnabled: true, onEnable: null, onDisable: null, exports: {} };
}

/** The function of a system as a scene adds it: bare, or in a definition. */
const runOf = (system: SystemLike): System => (typeof system === "function" ? system : system.run);

/** Runs a scene's setup the way Game does and returns what it added. */
function setup(scene: Scene) {
  const update: System[] = [];
  const render: System[] = [];
  const added: SystemLike[] = [];
  const world = new World();
  scene.setup({
    world,
    addSystem: (system) => {
      update.push(runOf(system));
      added.push(system);
    },
    addRenderSystem: (system) => {
      render.push(runOf(system));
      added.push(system);
    },
  });
  return { update, render, added, world };
}

describe("runsIn", () => {
  it("is every scene for null, otherwise the listed ones", () => {
    expect(runsIn(loaded("a", null), "anything")).toBe(true);
    expect(runsIn(loaded("a", ["play"]), "play")).toBe(true);
    expect(runsIn(loaded("a", ["play"]), "title")).toBe(false);
    expect(runsIn(loaded("a", []), "play")).toBe(false);
  });
});

describe("scenesFromScripts", () => {
  it("gives each scene its script's setup, or an empty one, in the project's order", () => {
    const play: LoadedScene = { name: "play", scene: { setup() {} }, exports: {} };
    const bonus: LoadedScene = { name: "bonus", scene: { setup() {} }, exports: {} };
    const scenes = scenesFromScripts(["title", "play"], [bonus, play]);
    expect(Object.keys(scenes)).toEqual(["title", "play"]);
    expect(scenes.play).toBe(play.scene);
    expect(() => setup(scenes.title)).not.toThrow();
    expect(setup(scenes.title).update).toEqual([]);
  });
});

describe("withScriptSystems", () => {
  const own: System = () => {};
  const scenes: Record<string, Scene> = {
    title: { setup: (scene) => scene.addSystem(own) },
    play: { setup() {} },
  };

  it("adds each scene's systems after its own setup, in script order", () => {
    const everywhere = loaded("everywhere", null);
    const playOnly = loaded("playOnly", ["play"]);
    const both = loaded("both", ["title", "play"]);
    const result = withScriptSystems(scenes, [playOnly, everywhere, both]);

    const title = setup(result.title);
    expect(title.update).toEqual([own, everywhere.system, both.system]);
    const play = setup(result.play);
    expect(play.update).toEqual([playOnly.system, everywhere.system, both.system]);
  });

  it("adds each script system under its name, with its hooks and starting switch", () => {
    const onEnable = () => {};
    const waiting = { ...loaded("boss", ["play"]), startsEnabled: false, onEnable };
    const { added } = setup(withScriptSystems(scenes, [waiting]).play);
    expect(added).toEqual([{ name: "boss", run: waiting.system, startsEnabled: false, onEnable, onDisable: undefined }]);
  });

  it("leaves disabled systems out", () => {
    const off = { ...loaded("off", null), disabled: true };
    const on = loaded("on", null);
    const result = withScriptSystems(scenes, [off, on]);
    expect(setup(result.play).update).toEqual([on.system]);
    expect(runsIn(off, "play")).toBe(true); // disabled is not about scenes
  });

  it("adds render-phase systems as render systems", () => {
    const draw = loaded("draw", null, "render");
    const result = withScriptSystems(scenes, [draw]);
    const play = setup(result.play);
    expect(play.update).toEqual([]);
    expect(play.render).toEqual([draw.system]);
  });

  it("keeps the scene names in order", () => {
    const result = withScriptSystems(scenes, []);
    expect(Object.keys(result)).toEqual(["title", "play"]);
  });

  it("ignores a scene a system names that does not exist (the loader reports it)", () => {
    const result = withScriptSystems(scenes, [loaded("a", ["bonus"])]);
    expect(setup(result.play).update).toEqual([]);
  });
});
