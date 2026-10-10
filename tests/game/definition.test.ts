import { describe, it, expect } from "vitest";
import {
  ComponentRegistry,
  findByName,
  spawnSceneData,
  Sprite,
  Transform,
  validateSceneData,
  World,
} from "../../src/engine";
import { definition } from "../../src/game/definition";

const registry = new ComponentRegistry(definition.components);

function spawnDefault(scene: string): World {
  const world = new World();
  spawnSceneData(world, validateSceneData(definition.scenes[scene].data, registry), registry);
  return world;
}

describe("demo game definition", () => {
  it("starts on a scene it declares", () => {
    expect(Object.keys(definition.scenes)).toEqual(["title", "play"]);
    expect(definition.firstScene).toBe("title");
  });

  it.each(["title", "play"])("%s default data is valid", (scene) => {
    expect(() => validateSceneData(definition.scenes[scene].data, registry)).not.toThrow();
  });

  it("only uses images the definition loads", () => {
    for (const scene of Object.keys(definition.scenes)) {
      for (const [, sprite] of spawnDefault(scene).query(Sprite)) {
        expect(Object.keys(definition.images)).toContain(sprite.image);
      }
    }
  });

  it("puts the player in the middle of the play scene", () => {
    const world = spawnDefault("play");
    const player = findByName(world, "Player");
    expect(player).toBeDefined();
    expect(world.get(player!, Transform)).toEqual(new Transform(384, 284));
  });
});
