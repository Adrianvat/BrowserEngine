import { describe, expect, it } from "vitest";
import { formatUsages, imageUsages } from "../../src/editor/image-usages";
import { component, ComponentRegistry, type SceneData } from "../../src/engine";

class Badge {
  icon = "";
}

const registry = new ComponentRegistry([component(Badge, "Badge", { icon: "image" })]);

const scenes: Record<string, SceneData> = {
  play: {
    version: 1,
    entities: [
      { name: "Hero", components: { Sprite: { image: "slime" } } },
      { name: "Box", components: { Rect: {} } },
      { name: "Other", components: { Sprite: { image: "background" } } },
    ],
  },
  title: {
    version: 1,
    entities: [
      { name: "Logo", components: { Sprite: { image: "slime" } } },
      { name: "", components: { Badge: { icon: "slime" } } },
    ],
  },
};

describe("imageUsages", () => {
  it("finds every entity with an image field set to the image, in any scene", () => {
    expect(imageUsages("slime", scenes, registry)).toEqual([
      { scene: "play", entity: "Hero" },
      { scene: "title", entity: "Logo" },
      { scene: "title", entity: "" },
    ]);
  });

  it("is empty for an unused image", () => {
    expect(imageUsages("coin", scenes, registry)).toEqual([]);
  });

  it("ignores components the registry doesn't know", () => {
    const unknown: Record<string, SceneData> = {
      s: { version: 1, entities: [{ name: "X", components: { Mystery: { image: "slime" } } }] },
    };
    expect(imageUsages("slime", unknown, registry)).toEqual([]);
  });
});

describe("formatUsages", () => {
  it("lists entity (scene) pairs", () => {
    expect(
      formatUsages([
        { scene: "play", entity: "Hero" },
        { scene: "title", entity: "" },
      ]),
    ).toBe("Hero (play), (unnamed) (title)");
  });
});
