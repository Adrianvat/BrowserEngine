import { describe, it, expect } from "vitest";
import { Keyboard, Scenes, Text, World, type Scene, type System } from "../../src/engine";
import { Plays } from "../../src/game/resources";
import { backToTitle, playScene } from "../../src/game/scenes/play";
import { startOnEnter, titleScene } from "../../src/game/scenes/title";
import { recordingCanvas } from "../helpers/recording-canvas";

/** A world with the resources the demo scenes use, as Game would provide them. */
function sceneWorld(plays = new Plays()) {
  const world = new World();
  const keyboard = new Keyboard();
  const scenes = new Scenes(() => true);
  world.setResource(recordingCanvas(800, 600).canvas);
  world.setResource(keyboard);
  world.setResource(scenes);
  world.setResource(plays);
  return { world, keyboard, scenes, plays };
}

/** Runs a scene's setup the way Game does; returns the systems it added. */
function runSetup(scene: Scene, world: World): System[] {
  const systems: System[] = [];
  scene.setup({
    world,
    addSystem: (system) => {
      systems.push(system);
    },
    addRenderSystem: () => {},
  });
  return systems;
}

function texts(world: World): string[] {
  return world.query(Text).map(([, text]) => text.value);
}

describe("startOnEnter", () => {
  it("switches to the play scene when Enter is pressed", () => {
    const { world, keyboard, scenes } = sceneWorld();
    keyboard.handleKeyDown("Enter");
    startOnEnter(world);
    expect(scenes.takeRequest()).toBe("play");
  });

  it("does nothing otherwise", () => {
    const { world, keyboard, scenes } = sceneWorld();
    keyboard.handleKeyDown("Space");
    startOnEnter(world);
    expect(scenes.takeRequest()).toBeNull();
  });
});

describe("backToTitle", () => {
  it("switches to the title scene when Escape is pressed", () => {
    const { world, keyboard, scenes } = sceneWorld();
    keyboard.handleKeyDown("Escape");
    backToTitle(world);
    expect(scenes.takeRequest()).toBe("title");
  });

  it("does nothing otherwise", () => {
    const { world, scenes } = sceneWorld();
    backToTitle(world);
    expect(scenes.takeRequest()).toBeNull();
  });
});

describe("titleScene", () => {
  it("shows the prompt and how many games were played, and listens for Enter", () => {
    const plays = new Plays();
    plays.count = 3;
    const { world } = sceneWorld(plays);
    const systems = runSetup(titleScene, world);
    expect(texts(world)).toEqual(["Press Enter to start", "Games played: 3"]);
    expect(systems).toContain(startOnEnter);
  });
});

describe("playScene", () => {
  it("counts the play, shows the hint, and listens for Escape", () => {
    const { world, plays } = sceneWorld();
    const systems = runSetup(playScene, world);
    expect(plays.count).toBe(1);
    expect(texts(world)).toEqual(["Esc: back to title"]);
    expect(systems).toContain(backToTitle);
  });
});
