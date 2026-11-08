import { beforeAll, describe, it, expect } from "vitest";
import {
  Body,
  Circle,
  Collider,
  CollisionLayers,
  ComponentRegistry,
  Keyboard,
  parseSceneData,
  physics,
  Rect,
  Scenes,
  scenesFromScripts,
  spawnSceneData,
  Text,
  Transform,
  Velocity,
  withScriptSystems,
  World,
  type ComponentType,
  type LoadedScripts,
  type Scene,
  type System,
} from "../../src/engine";
import {
  componentClass,
  demoProject,
  demoScripts,
  demoSettings,
  loadedScene,
  scene,
  system,
} from "../helpers/demo-project";
import { recordingCanvas } from "../helpers/recording-canvas";

const { sceneFiles } = demoProject();
const settings = demoSettings();
let scripts: LoadedScripts;
let registry: ComponentRegistry;
let Player: ComponentType<object>;
let startOnEnter: System;
let backToTitle: System;
let popToys: System;
let playScene: Scene;
let titleScene: Scene;
/** The play counter the play scene script exports and the title scene shows. */
let plays: { count: number };

beforeAll(async () => {
  scripts = await demoScripts();
  registry = new ComponentRegistry(
    scripts.components.map((component) => component.definition),
    new CollisionLayers(settings.collisionLayers).names,
  );
  Player = await componentClass("Player");
  startOnEnter = await system("startOnEnter");
  backToTitle = await system("backToTitle");
  popToys = await system("popToys");
  playScene = await scene("play");
  titleScene = await scene("title");
  plays = (await loadedScene("play")).exports.plays as { count: number };
});

/** Spawns a scene's file (projects/demo/scenes/<name>.json), as Game does before setup. */
function spawnDefault(world: World, scene: string): void {
  const file = sceneFiles.find((candidate) => candidate.name === scene);
  if (!file) throw new Error(`No scene file for "${scene}"`);
  spawnSceneData(world, parseSceneData(file.text, registry), registry);
}

/** A world with the resources the demo scenes use, as Game would provide them. */
function sceneWorld() {
  const world = new World();
  const keyboard = new Keyboard();
  const scenes = new Scenes(() => true);
  world.setResource(recordingCanvas(800, 600).canvas);
  world.setResource(keyboard);
  world.setResource(scenes);
  return { world, keyboard, scenes };
}

/** Runs a scene's setup the way Game does; returns the systems' functions it added. */
function runSetup(scene: Scene, world: World): System[] {
  const systems: System[] = [];
  scene.setup({
    world,
    addSystem: (system) => {
      systems.push(typeof system === "function" ? system : system.run);
    },
    addRenderSystem: () => {},
  });
  return systems;
}

/** The scene as the game page builds it: its scene script's setup plus its script systems. */
function withScripts(name: string): Scene {
  return withScriptSystems(scenesFromScripts(settings.scenes, scripts.scenes), scripts.systems)[name];
}

function texts(world: World): string[] {
  return world.query(Text).map(([, text]) => text.value);
}

describe("the project", () => {
  it("has a valid scene file for every scene", () => {
    for (const name of settings.scenes) {
      expect(() => spawnDefault(new World(), name), name).not.toThrow();
    }
  });

  it("ships scripts that all load, with the Player component and a setup for each scene", () => {
    expect(scripts.errors).toEqual([]);
    expect(scripts.components.map((component) => component.name)).toEqual(["Player"]);
    expect(scripts.scenes.map((scene) => scene.name)).toEqual(["play", "title"]);
  });

  it("runs the play systems in order around physics, and only Enter on the title", () => {
    const play = scripts.systems.filter((s) => s.scenes?.includes("play")).map((s) => s.name);
    expect(play).toEqual([
      "playerInput",
      "kick",
      "physics",
      "popToys",
      "playerAppearance",
      "backToTitle",
    ]);
    const title = scripts.systems.filter((s) => s.scenes?.includes("title")).map((s) => s.name);
    expect(title).toEqual(["startOnEnter"]);
    expect(scripts.systems.every((s) => s.scenes !== null)).toBe(true);
  });
});

describe("startOnEnter", () => {
  it("switches to the play scene when Enter is pressed", () => {
    const { world, keyboard, scenes } = sceneWorld();
    keyboard.handleKeyDown("Enter");
    startOnEnter(world, 0);
    expect(scenes.takeRequest()).toBe("play");
  });

  it("does nothing otherwise", () => {
    const { world, keyboard, scenes } = sceneWorld();
    keyboard.handleKeyDown("Space");
    startOnEnter(world, 0);
    expect(scenes.takeRequest()).toBeNull();
  });
});

describe("backToTitle", () => {
  it("switches to the title scene when Escape is pressed", () => {
    const { world, keyboard, scenes } = sceneWorld();
    keyboard.handleKeyDown("Escape");
    backToTitle(world, 0);
    expect(scenes.takeRequest()).toBe("title");
  });

  it("does nothing otherwise", () => {
    const { world, scenes } = sceneWorld();
    backToTitle(world, 0);
    expect(scenes.takeRequest()).toBeNull();
  });
});

describe("titleScene", () => {
  it("shows the number of games played on the Plays label, and listens for Enter", () => {
    plays.count = 3;
    const { world } = sceneWorld();
    spawnDefault(world, "title");
    const systems = runSetup(withScripts("title"), world);
    expect(texts(world)).toEqual(["Press Enter to start", "Games played: 3"]);
    expect(systems).toEqual([startOnEnter]);
  });

  it("still starts when the Plays label was removed in the editor", () => {
    const { world } = sceneWorld();
    expect(() => runSetup(titleScene, world)).not.toThrow();
  });
});

describe("playScene", () => {
  it("counts the play, adds 5 boxes and 5 balls, runs physics, and listens for Escape", () => {
    const { world } = sceneWorld();
    plays.count = 0;
    const systems = runSetup(withScripts("play"), world);
    expect(plays.count).toBe(1);
    const boxes = world.query(Rect, Velocity, Body, Collider);
    const balls = world.query(Circle, Velocity, Body, Collider);
    expect(boxes).toHaveLength(5);
    expect(balls).toHaveLength(5);
    expect(boxes.every(([, , , , collider]) => collider.shape === "box")).toBe(true);
    expect(balls.every(([, , , , collider]) => collider.shape === "circle")).toBe(true);
    expect(systems).toContain(physics);
    expect(systems.indexOf(popToys)).toBeGreaterThan(systems.indexOf(physics));
    expect(systems).toContain(backToTitle);
  });

  it("puts the walls, the hero and the toys on their collision layers", () => {
    const { world } = sceneWorld();
    spawnDefault(world, "play");
    runSetup(playScene, world);
    const layers = world.query(Collider).map(([, collider]) => collider.layer);
    expect(layers.filter((layer) => layer === "world")).toHaveLength(4);
    expect(layers.filter((layer) => layer === "player")).toHaveLength(1);
    expect(layers.filter((layer) => layer === "toy")).toHaveLength(10);
  });

  it("gives each toy a collider of its own size that starts inside the walls", () => {
    const { world } = sceneWorld();
    spawnDefault(world, "play");
    runSetup(playScene, world);
    const sizes = [
      ...world.query(Transform, Rect, Collider).map(([, t, rect, c]) => [t, rect.width, c] as const),
      ...world.query(Transform, Circle, Collider).map(([, t, ball, c]) => [t, 2 * ball.radius, c] as const),
    ];
    expect(sizes).toHaveLength(11); // 10 toys and the floor
    for (const [transform, size, collider] of sizes) {
      if (size === 800) continue; // the floor
      expect([collider.width, collider.height]).toEqual([size, size]);
      expect(transform.x).toBeGreaterThanOrEqual(0);
      expect(transform.x + size).toBeLessThanOrEqual(800);
      expect(transform.y).toBeGreaterThanOrEqual(0);
      expect(transform.y + size).toBeLessThanOrEqual(568);
    }
  });

  it("gives the hero a capsule inside its sprite", () => {
    const { world } = sceneWorld();
    spawnDefault(world, "play");
    const [[, , collider]] = world.query(Player, Collider);
    expect(collider).toMatchObject({ shape: "capsule", width: 24, height: 32, offsetX: 4 });
  });

  it("walls in the player and the toys, with the hero solid but weightless", () => {
    const { world } = sceneWorld();
    spawnDefault(world, "play");
    const statics = world.query(Transform, Collider).filter(([entity]) => !world.has(entity, Body));
    expect(statics).toHaveLength(4);
    const hero = world.query(Player, Body, Collider, Velocity);
    expect(hero).toHaveLength(1);
    expect(hero[0][2].gravityScale).toBe(0);
  });

  it("gives bigger toys more mass, with none heavier than 1.5", () => {
    const { world } = sceneWorld();
    runSetup(playScene, world);
    for (const [, collider, body] of world.query(Collider, Body)) {
      if (collider.layer !== "toy") continue;
      expect(body.mass).toBeCloseTo(collider.width / 24);
      expect(body.mass).toBeGreaterThanOrEqual(0.5);
      expect(body.mass).toBeLessThanOrEqual(1.5);
    }
  });
});
