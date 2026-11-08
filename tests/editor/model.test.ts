import { describe, it, expect } from "vitest";
import { EditorModel } from "../../src/editor/model";
import {
  component,
  formatSceneData,
  newProjectSettings,
  type ProjectSettings,
  type SceneData,
} from "../../src/engine";
import { FakeSceneFiles } from "../helpers/fake-scene-files";

class Spin {
  speed = 1;
}

const settings: ProjectSettings = {
  ...newProjectSettings("Test"),
  width: 200,
  height: 100,
  scenes: ["main", "other"],
  firstScene: "main",
};
const components = [component(Spin, "Spin", { speed: "number" })];
const images = () => ["hero", "bg"];

const MAIN: SceneData = {
  version: 1,
  entities: [
    { name: "Hero", components: { Transform: { x: 10, y: 20 } } },
    { name: "Box", components: { Rect: {} } },
  ],
};

/** Waits for writes that are on their way to land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A loaded model over fake files: "main" as MAIN and "other" empty, unless given otherwise. */
async function setup(
  texts: Record<string, string> = { main: formatSceneData(MAIN), other: formatSceneData({ version: 1, entities: [] }) },
  options: { reachable?: boolean; fallback?: boolean } = {},
) {
  const files = new FakeSceneFiles(texts);
  files.reachable = options.reachable ?? true;
  /** Every settings write, as written. */
  const written: ProjectSettings[] = [];
  const model = new EditorModel({
    settings,
    components,
    files,
    fallback: options.fallback ? async () => [{ name: "main", text: formatSceneData(MAIN) }] : undefined,
    writeSettings: async (next) => {
      written.push(next);
    },
    listImages: images,
  });
  await model.load();
  let changes = 0;
  model.onChange(() => changes++);
  /** What the files hold for a scene, parsed, or null. */
  const stored = (scene = "main") => files.dataOf(scene);
  return { model, files, stored, written, changes: () => changes };
}

function names(model: EditorModel): string[] {
  return model.data.entities.map((entity) => entity.name);
}

describe("loading and opening scenes", () => {
  it("starts on the first scene with its file's data", async () => {
    const { model, files } = await setup();
    expect(model.scene).toBe("main");
    expect(names(model)).toEqual(["Hero", "Box"]);
    expect(model.selected).toBeNull();
    expect(model.status).toBe("saved");
    expect(model.readOnly).toBe(false);
    expect(model.loadError).toBeNull();
    expect(model.sceneNames).toEqual(["main", "other"]);
    expect(model.imageNames).toEqual(["hero", "bg"]);
    expect(files.calls).toEqual(["load"]);
  });

  it("shows the first scene as empty before the files are read", () => {
    const model = new EditorModel({ settings, files: new FakeSceneFiles() });
    expect(model.scene).toBe("main");
    expect(model.data).toEqual({ version: 1, entities: [] });
  });

  it("a scene without a file is empty", async () => {
    const { model } = await setup({ main: formatSceneData(MAIN) });
    model.openScene("other");
    expect(model.data).toEqual({ version: 1, entities: [] });
    expect(model.loadError).toBeNull();
  });

  it("edits never change the file's data until they are written", async () => {
    const { model, files } = await setup();
    const before = files.texts.get("main");
    model.data.entities[0].name = "Changed";
    expect(files.texts.get("main")).toBe(before);
  });

  it("openScene switches scenes and clears the selection", async () => {
    const { model, changes } = await setup();
    model.select(0);
    model.openScene("other");
    expect(model.scene).toBe("other");
    expect(names(model)).toEqual([]);
    expect(model.selected).toBeNull();
    expect(changes()).toBe(2);
  });

  it("openScene rejects an unknown scene", async () => {
    const { model } = await setup();
    expect(() => model.openScene("nope")).toThrow('Scene "nope" not found');
  });

  it("falls back to the bundled scenes, read-only, when the files can't be reached", async () => {
    const { model } = await setup({}, { reachable: false, fallback: true });
    expect(model.readOnly).toBe(true);
    expect(model.status).toBe("readOnly");
    expect(names(model)).toEqual(["Hero", "Box"]);
    expect(model.loadError).toBeNull();
  });

  it("reports when the files can't be read and there is no fallback", async () => {
    const { model } = await setup({}, { reachable: false });
    expect(model.loadError).toBe("The scene files can't be read: /api/scenes is not there");
    expect(model.data.entities).toEqual([]);
    expect(() => model.addEntity()).toThrow('Scene "main" could not be read; fix its file to edit it');
  });
});

describe("selection", () => {
  it("select changes the selection without saving", async () => {
    const { model, files, changes } = await setup();
    model.select(1);
    expect(model.selected).toBe(1);
    expect(changes()).toBe(1);
    expect(files.calls).toEqual(["load"]);
    expect(model.status).toBe("saved");
    model.select(null);
    expect(model.selected).toBeNull();
  });

  it("select rejects an index with no entity", async () => {
    const { model } = await setup();
    expect(() => model.select(5)).toThrow("No entity at index 5");
  });
});

describe("entities", () => {
  it("addEntity adds a named entity at the center of the scene, selects it and writes the file", async () => {
    const { model, stored, changes } = await setup();
    model.addEntity();
    expect(names(model)).toEqual(["Hero", "Box", "Entity 1"]);
    expect(model.data.entities[2].components).toEqual({ Transform: { x: 100, y: 50 } });
    expect(model.selected).toBe(2);
    expect(model.status).toBe("saving");
    expect(changes()).toBe(1);
    await settle();
    expect(model.status).toBe("saved");
    expect(stored()!.entities).toHaveLength(3);
    expect(changes()).toBe(2);
  });

  it("names new entities with the smallest unused number", async () => {
    const { model } = await setup();
    model.addEntity();
    model.addEntity();
    model.addEntity();
    model.removeEntity(3); // "Entity 2"
    model.addEntity();
    expect(names(model)).toEqual(["Hero", "Box", "Entity 1", "Entity 3", "Entity 2"]);
  });

  it("removeEntity removes the entity and saves", async () => {
    const { model, stored } = await setup();
    model.removeEntity(0);
    expect(names(model)).toEqual(["Box"]);
    await settle();
    expect(stored()!.entities).toHaveLength(1);
  });

  it("removing the selected entity clears the selection", async () => {
    const { model } = await setup();
    model.select(0);
    model.removeEntity(0);
    expect(model.selected).toBeNull();
  });

  it("removing an entity before the selected one keeps the same entity selected", async () => {
    const { model } = await setup();
    model.select(1);
    model.removeEntity(0);
    expect(model.selected).toBe(0);
  });

  it("removing an entity after the selected one leaves the selection alone", async () => {
    const { model } = await setup();
    model.addEntity();
    model.select(0);
    model.removeEntity(2);
    expect(model.selected).toBe(0);
  });

  it("rename changes the name and saves", async () => {
    const { model, stored } = await setup();
    model.rename(0, "Player");
    expect(names(model)).toEqual(["Player", "Box"]);
    await settle();
    expect(stored()!.entities[0].name).toBe("Player");
  });
});

describe("components", () => {
  it("addComponent adds the component with its constructor defaults", async () => {
    const { model, stored } = await setup();
    model.addComponent(1, "Spin");
    model.addComponent(0, "Rect");
    expect(model.data.entities[1].components.Spin).toEqual({ speed: 1 });
    expect(model.data.entities[0].components.Rect).toEqual({
      width: 32,
      height: 32,
      color: "white",
    });
    await settle();
    expect(stored()!.entities[0].components.Rect).toBeDefined();
  });

  it("a new Collider is on the default layer, which the game's layer rules accept", async () => {
    const withLayers = {
      ...settings,
      collisionLayers: { player: { solid: ["world"], touch: ["coin"] } },
    };
    const model = new EditorModel({ settings: withLayers, files: new FakeSceneFiles({ main: formatSceneData(MAIN) }) });
    await model.load();
    model.addComponent(0, "Collider");
    expect(model.data.entities[0].components.Collider).toMatchObject({ layer: "default" });
    expect(model.registry.get("Collider")?.fields.layer).toEqual({
      choice: ["default", "player", "world", "coin"],
    });
    expect(() => model.setField(0, "Collider", "layer", "playr")).toThrow();
    model.setField(0, "Collider", "layer", "player");
    expect(model.data.entities[0].components.Collider).toMatchObject({ layer: "player" });
  });

  it("a new Sprite shows the first image and leaves its optional sizes empty", async () => {
    const { model } = await setup();
    model.addComponent(0, "Sprite");
    const sprite = model.data.entities[0].components.Sprite;
    expect(sprite).toEqual({ image: "hero", frame: 0, flipX: false, flipY: false });
    expect(Object.keys(sprite)).toEqual(["image", "frame", "flipX", "flipY"]);
  });

  it("addComponent rejects a component the entity has, or an unknown one", async () => {
    const { model } = await setup();
    expect(() => model.addComponent(0, "Transform")).toThrow("Entity 0 already has Transform");
    expect(() => model.addComponent(0, "Ghost")).toThrow('Unknown component "Ghost"');
  });

  it("removeComponent removes it and saves", async () => {
    const { model, stored } = await setup();
    model.removeComponent(0, "Transform");
    expect(model.data.entities[0].components).toEqual({});
    await settle();
    expect(stored()!.entities[0].components).toEqual({});
  });

  it("removeComponent rejects a component the entity does not have", async () => {
    const { model } = await setup();
    expect(() => model.removeComponent(0, "Rect")).toThrow("Entity 0 has no Rect");
    expect(() => model.removeComponent(0, "toString")).toThrow("Entity 0 has no toString");
  });
});

describe("fields", () => {
  it("setField sets the value and saves", async () => {
    const { model, stored } = await setup();
    model.setField(1, "Rect", "color", "red");
    expect(model.data.entities[1].components.Rect.color).toBe("red");
    await settle();
    expect(stored()!.entities[1].components.Rect.color).toBe("red");
  });

  it("setting an optional number to undefined leaves it empty", async () => {
    const { model } = await setup();
    model.addComponent(0, "Sprite");
    model.setField(0, "Sprite", "width", 40);
    expect(model.data.entities[0].components.Sprite.width).toBe(40);
    model.setField(0, "Sprite", "width", undefined);
    expect("width" in model.data.entities[0].components.Sprite).toBe(false);
  });

  it("setField rejects a value of the wrong kind", async () => {
    const { model } = await setup();
    expect(() => model.setField(1, "Rect", "width", "big")).toThrow(
      "Rect.width must be a number",
    );
    expect(() => model.setField(1, "Rect", "width", undefined)).toThrow(
      "Rect.width must be a number",
    );
  });

  it("setField rejects an unknown field, or a component the entity does not have", async () => {
    const { model } = await setup();
    expect(() => model.setField(1, "Rect", "depth", 1)).toThrow('Rect has no field "depth"');
    expect(() => model.setField(1, "Rect", "toString", 1)).toThrow(
      'Rect has no field "toString"',
    );
    expect(() => model.setField(0, "Rect", "width", 1)).toThrow("Entity 0 has no Rect");
  });
});

describe("fieldValue", () => {
  it("returns the saved value, or the component's default when the data leaves it out", async () => {
    const { model } = await setup();
    model.setField(1, "Rect", "color", "red");
    expect(model.fieldValue(1, "Rect", "color")).toBe("red");
    expect(model.fieldValue(1, "Rect", "width")).toBe(32);
  });

  it("is undefined for an empty optional number", async () => {
    const { model } = await setup();
    model.addComponent(0, "Sprite");
    expect(model.fieldValue(0, "Sprite", "width")).toBeUndefined();
  });

  it("rejects a component the entity does not have", async () => {
    const { model } = await setup();
    expect(() => model.fieldValue(0, "Rect", "width")).toThrow("Entity 0 has no Rect");
  });
});

describe("moving", () => {
  it("move sets the Transform to whole pixels and saves", async () => {
    const { model, stored } = await setup();
    model.move(0, 10.6, 20.2);
    expect(model.data.entities[0].components.Transform).toEqual({ x: 11, y: 20 });
    await settle();
    expect(stored()!.entities[0].components.Transform).toEqual({ x: 11, y: 20 });
  });

  it("move without saving still updates the views", async () => {
    const { model, files, changes } = await setup();
    model.move(0, 5, 5, false);
    expect(model.data.entities[0].components.Transform).toEqual({ x: 5, y: 5 });
    expect(changes()).toBe(1);
    expect(files.calls).toEqual(["load"]);
  });

  it("move gives an entity without a Transform one", async () => {
    const { model } = await setup();
    model.move(1, 3, 4);
    expect(model.data.entities[1].components.Transform).toEqual({ x: 3, y: 4 });
  });
});

describe("writing", () => {
  it("writes the open scene's file as formatted scene data, one write after another", async () => {
    const { model, files } = await setup();
    model.rename(0, "A");
    model.rename(0, "B");
    model.openScene("other");
    model.addEntity();
    expect(files.calls).toEqual(["load"]);
    await settle();
    expect(files.calls).toEqual(["load", "write main", "write main", "write other"]);
    expect(files.texts.get("main")).toBe(
      formatSceneData({ ...MAIN, entities: [{ ...MAIN.entities[0], name: "B" }, MAIN.entities[1]] }),
    );
    expect(files.dataOf("other")!.entities).toHaveLength(1);
  });

  it("a failed write is reported and the edit is kept", async () => {
    const { model, files } = await setup();
    files.failure = "Disk full";
    model.rename(0, "Player");
    await settle();
    expect(model.status).toEqual({ error: "Disk full" });
    expect(names(model)).toEqual(["Player", "Box"]);
    files.failure = null;
    model.rename(0, "Hero");
    await settle();
    expect(model.status).toBe("saved");
    expect(files.dataOf("main")!.entities[0].name).toBe("Hero");
  });

  it("read-only: edits are kept in memory, even across scenes, and nothing is written", async () => {
    const { model, files } = await setup({}, { reachable: false, fallback: true });
    model.addEntity();
    model.openScene("other");
    model.addEntity();
    model.openScene("main");
    await settle();
    expect(model.status).toBe("readOnly");
    expect(names(model)).toHaveLength(3);
    expect(files.calls).toEqual(["load"]);
  });
});

describe("load errors", () => {
  it("a broken file is reported, naming it, and shown as empty", async () => {
    const { model } = await setup({ main: "{oops" });
    expect(model.loadError).toMatch(/^Scene "main" \(main\.json\): Scene data is not valid JSON/);
    expect(names(model)).toEqual([]);
    expect(model.status).toBe("saved");
  });

  it("a broken scene cannot be edited until its file is fixed", async () => {
    const { model, files } = await setup({ main: "{oops" });
    const blocked = 'Scene "main" could not be read; fix its file to edit it';
    expect(() => model.rename(0, "x")).toThrow(blocked);
    expect(() => model.addEntity()).toThrow(blocked);
    expect(() => model.move(0, 1, 1)).toThrow(blocked);
    files.texts.set("main", formatSceneData(MAIN));
    await model.reload();
    expect(model.loadError).toBeNull();
    model.rename(0, "x");
    expect(names(model)).toEqual(["x", "Box"]);
  });
});

describe("reload", () => {
  it("shows a scene changed on disk, keeping the selection, and says nothing when nothing changed", async () => {
    const { model, changes } = await setup();
    model.select(1);
    await model.reload();
    expect(changes()).toBe(1);
    const { files } = await setup();
    const other = await setup();
    void other;
    files.texts.set("main", formatSceneData({ version: 1, entities: [{ name: "New", components: {} }, MAIN.entities[1]] }));
    const ctx = await setup(Object.fromEntries(files.texts));
    ctx.model.select(1);
    ctx.files.texts.set("main", formatSceneData({ version: 1, entities: [{ name: "Fresh", components: {} }] }));
    await ctx.model.reload();
    expect(names(ctx.model)).toEqual(["Fresh"]);
    expect(ctx.model.selected).toBeNull(); // entity 1 is gone
    expect(ctx.changes()).toBe(2);
  });

  it("sees a file written by another program for a scene that is not open", async () => {
    const { model, files } = await setup();
    files.texts.set("other", formatSceneData({ version: 1, entities: [{ name: "Elsewhere", components: {} }] }));
    await model.reload();
    expect(model.allScenes().other.entities[0].name).toBe("Elsewhere");
  });

  it("does not read the files while this editor's writes are on their way, or when read-only", async () => {
    const { model, files } = await setup();
    model.rename(0, "Mine");
    files.texts.set("main", formatSceneData({ version: 1, entities: [] }));
    await model.reload();
    expect(names(model)).toEqual(["Mine", "Box"]);
    await settle();
    expect(files.dataOf("main")!.entities[0].name).toBe("Mine");

    const readOnly = await setup({}, { reachable: false, fallback: true });
    await readOnly.model.reload();
    expect(readOnly.files.calls).toEqual(["load"]);
  });

  it("reports the files becoming unreadable", async () => {
    const { model, files } = await setup();
    files.failure = "gone";
    await model.reload();
    expect(model.loadError).toBe("The scene files can't be read: gone");
    files.failure = null;
    await model.reload();
    expect(model.loadError).toBeNull();
    expect(names(model)).toEqual(["Hero", "Box"]);
  });
});

describe("importScene", () => {
  it("replaces a scene's file with checked data and shows it when it is open", async () => {
    const { model, files } = await setup();
    model.select(0);
    await model.importScene("main", JSON.stringify({ version: 1, entities: [{ name: "Old", components: {} }] }));
    expect(names(model)).toEqual(["Old"]);
    expect(model.selected).toBeNull();
    expect(files.dataOf("main")!.entities[0].name).toBe("Old");
    await model.importScene("other", JSON.stringify({ version: 1, entities: [] }));
    expect(model.scene).toBe("main");
    expect(files.calls).toEqual(["load", "write main", "write other"]);
  });

  it("rejects data that does not fit the components, an unknown scene, and read-only", async () => {
    const { model, files } = await setup();
    await expect(model.importScene("main", "{oops")).rejects.toThrow("not valid JSON");
    await expect(
      model.importScene("main", JSON.stringify({ version: 1, entities: [{ name: "x", components: { Nope: {} } }] })),
    ).rejects.toThrow('unknown component "Nope"');
    await expect(model.importScene("nope", "{}")).rejects.toThrow('Scene "nope" not found');
    expect(files.calls).toEqual(["load"]);
    const readOnly = await setup({}, { reachable: false, fallback: true });
    await expect(readOnly.model.importScene("main", "{}")).rejects.toThrow("start the dev server");
  });
});

describe("image names from the library", () => {
  it("reads the names from the function it is given, each time", async () => {
    let names = ["slime"];
    const model = new EditorModel({ settings, files: new FakeSceneFiles(), listImages: () => names });
    expect(model.imageNames).toEqual(["slime"]);
    names = ["slime", "coin"];
    expect(model.imageNames).toEqual(["slime", "coin"]);
  });

  it("gives a new Sprite the first name from that function", async () => {
    const model = new EditorModel({ settings, files: new FakeSceneFiles(), listImages: () => ["slime"] });
    await model.load();
    model.addEntity();
    model.addComponent(0, "Sprite");
    expect(model.data.entities[0].components.Sprite.image).toBe("slime");
  });

  it("imagesChanged notifies listeners without saving", async () => {
    const { model, changes, files } = await setup();
    model.imagesChanged();
    expect(changes()).toBe(1);
    expect(files.calls).toEqual(["load"]);
  });
});

describe("allScenes", () => {
  it("has the open scene's edits and the other scenes' files", async () => {
    const { model } = await setup({
      main: formatSceneData(MAIN),
      other: JSON.stringify({ version: 1, entities: [{ name: "Saved", components: {} }] }),
    });
    model.rename(0, "Edited");
    const scenes = model.allScenes();
    expect(Object.keys(scenes)).toEqual(["main", "other"]);
    expect(scenes.main.entities.map((entity) => entity.name)).toEqual(["Edited", "Box"]);
    expect(scenes.other.entities.map((entity) => entity.name)).toEqual(["Saved"]);
  });

  it("shows scenes without a file as empty", async () => {
    const { model } = await setup({ main: formatSceneData(MAIN) });
    expect(model.allScenes().other).toEqual({ version: 1, entities: [] });
  });

  it("leaves out scenes whose file can't be read", async () => {
    expect(Object.keys((await setup({ main: formatSceneData(MAIN), other: "not json" })).model.allScenes())).toEqual(["main"]);
    expect(Object.keys((await setup({ main: "not json", other: "{}" })).model.allScenes())).toEqual([]);
    expect(Object.keys((await setup({ main: "not json" })).model.allScenes())).toEqual(["other"]);
  });
});

describe("setComponents", () => {
  class Bounce {
    height = 10;
  }
  const bounce = component(Bounce, "Bounce", { height: "number" });

  it("offers the new components and keeps the scene and selection", async () => {
    const { model, changes } = await setup();
    model.select(1);
    model.setComponents([...components, bounce]);
    expect(model.registry.get("Bounce")).toBe(bounce);
    expect(model.registry.get("Spin")).toBeDefined();
    expect(model.scene).toBe("main");
    expect(model.selected).toBe(1);
    expect(changes()).toBe(2);
    model.addComponent(1, "Bounce");
    expect(model.data.entities[1].components.Bounce).toEqual({ height: 10 });
  });

  it("re-reads the file against the new components", async () => {
    const text = JSON.stringify({
      version: 1,
      entities: [{ name: "Ball", components: { Bounce: { height: 3 } } }],
    });
    const { model } = await setup({ main: text });
    expect(model.loadError).toContain('unknown component "Bounce"');
    model.setComponents([bounce]);
    expect(model.loadError).toBeNull();
    expect(names(model)).toEqual(["Ball"]);
    expect(model.status).toBe("saved");
  });

  it("keeps unsaved edits, reports a file that no longer fits, and drops a stale selection", async () => {
    const { model } = await setup();
    model.select(1);
    model.addComponent(1, "Spin");
    model.setComponents([]); // Spin is gone, and the scene now uses it.
    expect(model.loadError).toBe('Scene "main" (main.json): Entity 1 ("Box"): unknown component "Spin"');
    expect(model.data.entities).toEqual([]);
    expect(model.selected).toBeNull();
    expect(() => model.addEntity()).toThrow("could not be read");
    model.setComponents(components);
    expect(model.loadError).toBeNull();
    expect(names(model)).toEqual(["Hero", "Box"]);
    expect(model.data.entities[1].components.Spin).toEqual({ speed: 1 });
    expect(model.selected).toBeNull();
  });
});

describe("scenes of the project", () => {
  it("addScene adds an empty scene, writes its file and the settings, and opens it", async () => {
    const { model, files, written, changes } = await setup();
    model.addScene("level1");
    expect(model.sceneNames).toEqual(["main", "other", "level1"]);
    expect(model.scene).toBe("level1");
    expect(model.data.entities).toEqual([]);
    expect(model.firstScene).toBe("main");
    expect(changes()).toBe(1);
    await settle();
    expect(files.dataOf("level1")).toEqual({ version: 1, entities: [] });
    expect(written.map((s) => s.scenes)).toEqual([["main", "other", "level1"]]);
    expect(written[0]).not.toBe(model.settings);
    expect(model.status).toBe("saved");
  });

  it("checks a new scene's name", async () => {
    const { model } = await setup();
    expect(model.sceneNameProblem("main")).toBe('There is already a scene "main"');
    expect(model.sceneNameProblem("my scene")).toContain("letters, digits");
    expect(model.sceneNameProblem("level-2")).toBeNull();
    expect(() => model.addScene("main")).toThrow('There is already a scene "main"');
    expect(() => model.addScene("../x")).toThrow("letters, digits");
  });

  it("removeScene takes the scene out, deletes its file, and opens the next one", async () => {
    const { model, files, written } = await setup();
    model.removeScene("main");
    expect(model.sceneNames).toEqual(["other"]);
    expect(model.scene).toBe("other");
    expect(model.firstScene).toBe("other");
    await settle();
    expect(files.texts.has("main")).toBe(false);
    expect(written[0]).toMatchObject({ scenes: ["other"], firstScene: "other" });
    expect(() => model.removeScene("other")).toThrow("at least one scene");
    expect(() => model.removeScene("nope")).toThrow('Scene "nope" not found');
  });

  it("removing another scene keeps the open one", async () => {
    const { model } = await setup();
    model.select(1);
    model.removeScene("other");
    expect(model.scene).toBe("main");
    expect(model.selected).toBe(1);
    expect(model.allScenes()).not.toHaveProperty("other");
  });

  it("setFirstScene changes the start scene and writes the settings", async () => {
    const { model, written } = await setup();
    model.setFirstScene("other");
    expect(model.firstScene).toBe("other");
    await settle();
    expect(written[0].firstScene).toBe("other");
    expect(() => model.setFirstScene("nope")).toThrow('Scene "nope" not found');
  });

  it("reports a settings write that fails", async () => {
    const files = new FakeSceneFiles({ main: formatSceneData(MAIN) });
    const model = new EditorModel({
      settings,
      files,
      writeSettings: async () => {
        throw new Error("disk full");
      },
    });
    await model.load();
    model.setFirstScene("other");
    await settle();
    expect(model.status).toEqual({ error: "disk full" });
  });

  it("can't change the scenes when read-only or without a way to write the settings", async () => {
    const readOnly = await setup({}, { reachable: false, fallback: true });
    expect(() => readOnly.model.addScene("x")).toThrow("start the dev server");
    expect(() => readOnly.model.removeScene("main")).toThrow("start the dev server");
    expect(() => readOnly.model.setFirstScene("other")).toThrow("start the dev server");
    const model = new EditorModel({ settings, files: new FakeSceneFiles() });
    await model.load();
    expect(() => model.addScene("x")).toThrow("start the dev server");
  });
});
