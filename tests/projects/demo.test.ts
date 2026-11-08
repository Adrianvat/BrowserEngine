import { beforeAll, describe, it, expect } from "vitest";
import {
  CollisionLayers,
  ComponentRegistry,
  findByName,
  parseSceneData,
  spawnSceneData,
  Sprite,
  Transform,
  World,
} from "../../src/engine";
import { bundledProjects } from "../../src/project/bundle";
import { demoProject, demoScripts, demoSettings } from "../helpers/demo-project";

const { imageFiles, sceneFiles } = demoProject();
const settings = demoSettings();
let registry: ComponentRegistry;

beforeAll(async () => {
  const scripts = await demoScripts();
  registry = new ComponentRegistry(
    scripts.components.map((component) => component.definition),
    new CollisionLayers(settings.collisionLayers).names,
  );
});

/** A scene's file (projects/demo/scenes/<name>.json), as the game reads it. */
function sceneText(scene: string): string {
  const file = sceneFiles.find((candidate) => candidate.name === scene);
  if (!file) throw new Error(`No scene file for "${scene}"`);
  return file.text;
}

function spawnScene(scene: string): World {
  const world = new World();
  spawnSceneData(world, parseSceneData(sceneText(scene), registry), registry);
  return world;
}

describe("demo project", () => {
  it("is the only project shipped, and starts on a scene it declares", () => {
    expect(Object.keys(bundledProjects)).toEqual(["demo"]);
    expect(settings.name).toBe("Demo");
    expect(settings.scenes).toEqual(["title", "play"]);
    expect(settings.firstScene).toBe("title");
    expect(settings).toMatchObject({ width: 800, height: 600, pixelArt: true, gravity: { x: 0, y: 980 } });
  });

  it("has a scene file for every scene, and none for other scenes", () => {
    expect(sceneFiles.map((file) => file.name).sort()).toEqual(["play", "title"]);
  });

  it.each(["title", "play"])("%s's scene file is valid", (scene) => {
    expect(() => parseSceneData(sceneText(scene), registry)).not.toThrow();
  });

  it("ships its images as files, with the hero as a sheet", () => {
    expect(imageFiles.map((image) => image.name)).toEqual(["background", "hero"]);
    expect(imageFiles.every((image) => image.error === undefined)).toBe(true);
    expect(imageFiles[1].sheet).toMatchObject({ frameWidth: 16, frameHeight: 16 });
    expect(Object.keys(imageFiles[1].sheet!.animations)).toEqual(["idle", "walk"]);
  });

  it("only uses images the game loads", () => {
    const names = imageFiles.map((image) => image.name);
    for (const scene of settings.scenes) {
      for (const [, sprite] of spawnScene(scene).query(Sprite)) {
        expect(names).toContain(sprite.image);
      }
    }
  });

  it("puts the player in the middle of the play scene", () => {
    const world = spawnScene("play");
    const player = findByName(world, "Player");
    expect(player).toBeDefined();
    expect(world.get(player!, Transform)).toEqual(new Transform(384, 284));
  });
});
