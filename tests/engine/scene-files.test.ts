import { describe, expect, it } from "vitest";
import {
  collectSceneFiles,
  formatSceneData,
  isSceneName,
  sceneFile,
  sceneFromFile,
  validateSceneShape,
  type SceneData,
} from "../../src/engine";
import playText from "../../projects/demo/scenes/play.json?raw";
import titleText from "../../projects/demo/scenes/title.json?raw";

const data: SceneData = {
  version: 1,
  entities: [
    {
      name: "Background",
      components: { Transform: { x: 0, y: 0 }, Sprite: { image: "background" }, Layer: { value: -1 } },
    },
    { name: "Bare", components: {} },
    { name: "Box", components: { Rect: {} } },
  ],
};

describe("scene names and files", () => {
  it("accepts letters, digits, _ and -, nothing that could be a path", () => {
    for (const name of ["play", "Title2", "my_scene", "level-1"]) expect(isSceneName(name)).toBe(true);
    for (const name of ["", "my scene", "../play", "a/b", "-x", ".hidden"]) expect(isSceneName(name)).toBe(false);
  });

  it("names a scene's file and reads it back from a path", () => {
    expect(sceneFile("play")).toBe("play.json");
    expect(sceneFromFile("./play.json")).toBe("play");
    expect(sceneFromFile("play.json")).toBe("play");
    expect(sceneFromFile("src/game/scenes/title.json")).toBe("title");
    expect(sceneFromFile("./play.ts")).toBeNull();
    expect(sceneFromFile("./index.ts")).toBeNull();
    expect(sceneFromFile("./my scene.json")).toBeNull();
  });

  it("collects the scene files among a set of files, by name", () => {
    expect(
      collectSceneFiles({ "./title.json": "t", "./play.json": "p", "./play.ts": "code", "./notes.txt": "x" }),
    ).toEqual([
      { name: "play", text: "p" },
      { name: "title", text: "t" },
    ]);
  });
});

describe("formatSceneData", () => {
  it("writes one line per component, in the style of the shipped scene files", () => {
    expect(formatSceneData(data)).toBe(
      `{
  "version": 1,
  "entities": [
    {
      "name": "Background",
      "components": {
        "Transform": { "x": 0, "y": 0 },
        "Sprite": { "image": "background" },
        "Layer": { "value": -1 }
      }
    },
    {
      "name": "Bare",
      "components": {}
    },
    {
      "name": "Box",
      "components": {
        "Rect": {}
      }
    }
  ]
}
`,
    );
    expect(formatSceneData({ version: 1, entities: [] })).toBe('{\n  "version": 1,\n  "entities": []\n}\n');
  });

  it("puts the fields of a component that would not fit in 120 columns on their own lines", () => {
    const long = "x".repeat(80);
    const text = formatSceneData({
      version: 1,
      entities: [{ name: "Hint", components: { Text: { value: long, size: 14 }, Layer: { value: 2 } } }],
    });
    expect(text).toContain(`        "Text": {\n          "value": "${long}",\n          "size": 14\n        },\n        "Layer": { "value": 2 }\n`);
    const fits = formatSceneData({
      version: 1,
      entities: [{ name: "Hint", components: { Text: { value: "x".repeat(88) } } }],
    });
    expect(fits).toContain(`        "Text": { "value": "${"x".repeat(88)}" }\n`);
    expect(fits.split("\n").find((line) => line.includes('"Text"'))!.length).toBe(119);
  });

  it("round-trips through JSON, escaping what needs it", () => {
    const odd: SceneData = {
      version: 1,
      entities: [{ name: 'Say "hi"\n', components: { Text: { value: "a\\b", align: "left" } } }],
    };
    expect(JSON.parse(formatSceneData(odd))).toEqual(odd);
  });

  it("reproduces the demo's scene files exactly (whatever their line endings)", () => {
    for (const text of [playText, titleText]) {
      expect(formatSceneData(validateSceneShape(JSON.parse(text)))).toBe(text.replace(/\r\n/g, "\n"));
    }
  });
});

describe("validateSceneShape", () => {
  it("returns a fresh copy of well-shaped data, whatever the components", () => {
    const value = { version: 1, entities: [{ name: "X", components: { Anything: { a: 1 } } }] };
    const checked = validateSceneShape(value);
    expect(checked).toEqual(value);
    expect(checked.entities[0].components.Anything).not.toBe(value.entities[0].components.Anything);
  });

  it("rejects the wrong shape with the same messages as validateSceneData", () => {
    expect(() => validateSceneShape(null)).toThrow('Scene data must be an object with "version" and "entities"');
    expect(() => validateSceneShape({ version: 2, entities: [] })).toThrow("Unsupported scene data version: 2");
    expect(() => validateSceneShape({ version: 1, entities: [{ name: "x" }] })).toThrow(
      'Entity 0 must have a "name" string and a "components" object',
    );
    expect(() => validateSceneShape({ version: 1, entities: [{ name: "x", components: { A: 1 } }] })).toThrow(
      'Entity 0 ("x"): A must be an object of field values',
    );
  });
});
