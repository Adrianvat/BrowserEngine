import { describe, it, expect } from "vitest";
import { EditorModel } from "../../src/editor/model";
import { component, SceneStore, type GameDefinition } from "../../src/engine";
import { MemoryStorage } from "../helpers/memory-storage";

class Spin {
  speed = 1;
}

const KEY = "browser-engine:scene:";

const definition: GameDefinition = {
  width: 200,
  height: 100,
  images: { hero: "/hero.png", bg: "/bg.png" },
  components: [component(Spin, "Spin", { speed: "number" })],
  scenes: {
    main: {
      scene: { setup() {} },
      data: {
        version: 1,
        entities: [
          { name: "Hero", components: { Transform: { x: 10, y: 20 } } },
          { name: "Box", components: { Rect: {} } },
        ],
      },
    },
    other: { scene: { setup() {} }, data: { version: 1, entities: [] } },
  },
  firstScene: "main",
};

/** A model over a fake storage, optionally holding saved JSON text per scene. */
function setup(saved: Record<string, string> = {}, storage: MemoryStorage | null = new MemoryStorage()) {
  for (const [scene, text] of Object.entries(saved)) storage?.setItem(KEY + scene, text);
  const model = new EditorModel(definition, new SceneStore(storage));
  let changes = 0;
  model.onChange(() => changes++);
  /** What the store holds for a scene, parsed, or null. */
  const stored = (scene = "main") => {
    const text = storage?.getItem(KEY + scene) ?? null;
    return text === null ? null : JSON.parse(text);
  };
  return { model, storage, stored, changes: () => changes };
}

function names(model: EditorModel): string[] {
  return model.data.entities.map((entity) => entity.name);
}

describe("opening scenes", () => {
  it("starts on the first scene with its default data", () => {
    const { model } = setup();
    expect(model.scene).toBe("main");
    expect(names(model)).toEqual(["Hero", "Box"]);
    expect(model.selected).toBeNull();
    expect(model.status).toBe("default");
    expect(model.loadError).toBeNull();
    expect(model.sceneNames).toEqual(["main", "other"]);
    expect(model.imageNames).toEqual(["hero", "bg"]);
  });

  it("loads the saved copy when there is one", () => {
    const saved = JSON.stringify({ version: 1, entities: [{ name: "Saved", components: {} }] });
    const { model } = setup({ main: saved });
    expect(names(model)).toEqual(["Saved"]);
    expect(model.status).toBe("saved");
  });

  it("openScene switches scenes and clears the selection", () => {
    const { model, changes } = setup();
    model.select(0);
    model.openScene("other");
    expect(model.scene).toBe("other");
    expect(names(model)).toEqual([]);
    expect(model.selected).toBeNull();
    expect(changes()).toBe(2);
  });

  it("openScene rejects an unknown scene", () => {
    const { model } = setup();
    expect(() => model.openScene("nope")).toThrow('Scene "nope" not found');
  });
});

describe("selection", () => {
  it("select changes the selection without saving", () => {
    const { model, stored, changes } = setup();
    model.select(1);
    expect(model.selected).toBe(1);
    expect(changes()).toBe(1);
    expect(stored()).toBeNull();
    expect(model.status).toBe("default");
    model.select(null);
    expect(model.selected).toBeNull();
  });

  it("select rejects an index with no entity", () => {
    const { model } = setup();
    expect(() => model.select(5)).toThrow("No entity at index 5");
  });
});

describe("entities", () => {
  it("addEntity adds a named entity at the center of the scene, selects it and saves", () => {
    const { model, stored, changes } = setup();
    model.addEntity();
    expect(names(model)).toEqual(["Hero", "Box", "Entity 1"]);
    expect(model.data.entities[2].components).toEqual({ Transform: { x: 100, y: 50 } });
    expect(model.selected).toBe(2);
    expect(model.status).toBe("saved");
    expect(stored().entities).toHaveLength(3);
    expect(changes()).toBe(1);
  });

  it("names new entities with the smallest unused number", () => {
    const { model } = setup();
    model.addEntity();
    model.addEntity();
    model.addEntity();
    model.removeEntity(3); // "Entity 2"
    model.addEntity();
    expect(names(model)).toEqual(["Hero", "Box", "Entity 1", "Entity 3", "Entity 2"]);
  });

  it("removeEntity removes the entity and saves", () => {
    const { model, stored } = setup();
    model.removeEntity(0);
    expect(names(model)).toEqual(["Box"]);
    expect(stored().entities).toHaveLength(1);
  });

  it("removing the selected entity clears the selection", () => {
    const { model } = setup();
    model.select(0);
    model.removeEntity(0);
    expect(model.selected).toBeNull();
  });

  it("removing an entity before the selected one keeps the same entity selected", () => {
    const { model } = setup();
    model.select(1);
    model.removeEntity(0);
    expect(model.selected).toBe(0);
  });

  it("removing an entity after the selected one leaves the selection alone", () => {
    const { model } = setup();
    model.addEntity();
    model.select(0);
    model.removeEntity(2);
    expect(model.selected).toBe(0);
  });

  it("rename changes the name and saves", () => {
    const { model, stored } = setup();
    model.rename(0, "Player");
    expect(names(model)).toEqual(["Player", "Box"]);
    expect(stored().entities[0].name).toBe("Player");
  });
});

describe("components", () => {
  it("addComponent adds the component with its constructor defaults", () => {
    const { model, stored } = setup();
    model.addComponent(1, "Spin");
    model.addComponent(0, "Rect");
    expect(model.data.entities[1].components.Spin).toEqual({ speed: 1 });
    expect(model.data.entities[0].components.Rect).toEqual({
      width: 32,
      height: 32,
      color: "white",
    });
    expect(stored().entities[0].components.Rect).toBeDefined();
  });

  it("a new Sprite shows the first image and leaves its optional sizes empty", () => {
    const { model } = setup();
    model.addComponent(0, "Sprite");
    const sprite = model.data.entities[0].components.Sprite;
    expect(sprite).toEqual({ image: "hero", frame: 0, flipX: false, flipY: false });
    expect(Object.keys(sprite)).toEqual(["image", "frame", "flipX", "flipY"]);
  });

  it("addComponent rejects a component the entity has, or an unknown one", () => {
    const { model } = setup();
    expect(() => model.addComponent(0, "Transform")).toThrow("Entity 0 already has Transform");
    expect(() => model.addComponent(0, "Ghost")).toThrow('Unknown component "Ghost"');
  });

  it("removeComponent removes it and saves", () => {
    const { model, stored } = setup();
    model.removeComponent(0, "Transform");
    expect(model.data.entities[0].components).toEqual({});
    expect(stored().entities[0].components).toEqual({});
  });

  it("removeComponent rejects a component the entity does not have", () => {
    const { model } = setup();
    expect(() => model.removeComponent(0, "Rect")).toThrow("Entity 0 has no Rect");
    expect(() => model.removeComponent(0, "toString")).toThrow("Entity 0 has no toString");
  });
});

describe("fields", () => {
  it("setField sets the value and saves", () => {
    const { model, stored } = setup();
    model.setField(1, "Rect", "color", "red");
    expect(model.data.entities[1].components.Rect.color).toBe("red");
    expect(stored().entities[1].components.Rect.color).toBe("red");
  });

  it("setting an optional number to undefined leaves it empty", () => {
    const { model } = setup();
    model.addComponent(0, "Sprite");
    model.setField(0, "Sprite", "width", 40);
    expect(model.data.entities[0].components.Sprite.width).toBe(40);
    model.setField(0, "Sprite", "width", undefined);
    expect("width" in model.data.entities[0].components.Sprite).toBe(false);
  });

  it("setField rejects a value of the wrong kind", () => {
    const { model } = setup();
    expect(() => model.setField(1, "Rect", "width", "big")).toThrow(
      "Rect.width must be a number",
    );
    expect(() => model.setField(1, "Rect", "width", undefined)).toThrow(
      "Rect.width must be a number",
    );
  });

  it("setField rejects an unknown field, or a component the entity does not have", () => {
    const { model } = setup();
    expect(() => model.setField(1, "Rect", "depth", 1)).toThrow('Rect has no field "depth"');
    expect(() => model.setField(1, "Rect", "toString", 1)).toThrow(
      'Rect has no field "toString"',
    );
    expect(() => model.setField(0, "Rect", "width", 1)).toThrow("Entity 0 has no Rect");
  });
});

describe("fieldValue", () => {
  it("returns the saved value, or the component's default when the data leaves it out", () => {
    const { model } = setup();
    model.setField(1, "Rect", "color", "red");
    expect(model.fieldValue(1, "Rect", "color")).toBe("red");
    expect(model.fieldValue(1, "Rect", "width")).toBe(32);
  });

  it("is undefined for an empty optional number", () => {
    const { model } = setup();
    model.addComponent(0, "Sprite");
    expect(model.fieldValue(0, "Sprite", "width")).toBeUndefined();
  });

  it("rejects a component the entity does not have", () => {
    const { model } = setup();
    expect(() => model.fieldValue(0, "Rect", "width")).toThrow("Entity 0 has no Rect");
  });
});

describe("moving", () => {
  it("move sets the Transform to whole pixels and saves", () => {
    const { model, stored } = setup();
    model.move(0, 10.6, 20.2);
    expect(model.data.entities[0].components.Transform).toEqual({ x: 11, y: 20 });
    expect(stored().entities[0].components.Transform).toEqual({ x: 11, y: 20 });
  });

  it("move without saving still updates the views", () => {
    const { model, stored, changes } = setup();
    model.move(0, 5, 5, false);
    expect(model.data.entities[0].components.Transform).toEqual({ x: 5, y: 5 });
    expect(changes()).toBe(1);
    expect(stored()).toBeNull();
  });

  it("move gives an entity without a Transform one", () => {
    const { model } = setup();
    model.move(1, 3, 4);
    expect(model.data.entities[1].components.Transform).toEqual({ x: 3, y: 4 });
  });
});

describe("saving problems", () => {
  it("a failed save is reported and the edit is kept", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("Quota exceeded");
    };
    const { model } = setup({}, storage);
    model.rename(0, "Player");
    expect(model.status).toEqual({ error: "Quota exceeded" });
    expect(names(model)).toEqual(["Player", "Box"]);
  });

  it("without browser storage, edits are kept in memory and reported as not saved", () => {
    const { model } = setup({}, null);
    model.addEntity();
    expect(model.status).toEqual({ error: "Browser storage is not available" });
    expect(names(model)).toHaveLength(3);
  });
});

describe("load errors and reset", () => {
  it("a broken saved copy is reported, and the default is shown meanwhile", () => {
    const { model } = setup({ main: "{oops" });
    expect(model.loadError).toMatch(/^Scene "main": Scene data is not valid JSON/);
    expect(names(model)).toEqual(["Hero", "Box"]);
    expect(model.status).toBe("default");
  });

  it("a broken scene cannot be edited until it is reset", () => {
    const { model, stored } = setup({ main: "{oops" });
    const blocked = 'Scene "main" could not be loaded; reset it to edit it';
    expect(() => model.rename(0, "x")).toThrow(blocked);
    expect(() => model.addEntity()).toThrow(blocked);
    expect(() => model.move(0, 1, 1)).toThrow(blocked);
    model.resetScene();
    expect(model.loadError).toBeNull();
    expect(stored()).toBeNull();
    model.rename(0, "x");
    expect(names(model)).toEqual(["x", "Box"]);
  });

  it("resetScene deletes the saved copy and brings back the untouched default", () => {
    const { model, stored, changes } = setup();
    model.rename(0, "Changed");
    model.setField(0, "Transform", "x", 99);
    model.select(0);
    model.resetScene();
    expect(names(model)).toEqual(["Hero", "Box"]);
    expect(model.data.entities[0].components.Transform).toEqual({ x: 10, y: 20 });
    expect(stored()).toBeNull();
    expect(model.status).toBe("default");
    expect(model.selected).toBeNull();
    expect(changes()).toBe(4);
  });

  it("a failed reset is reported", () => {
    const { model } = setup({}, null);
    model.resetScene();
    expect(model.status).toEqual({ error: "Browser storage is not available" });
  });
});
