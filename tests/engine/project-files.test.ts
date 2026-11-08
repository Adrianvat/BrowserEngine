import { describe, expect, it } from "vitest";
import {
  formatProjectSettings,
  isProjectId,
  newProjectSettings,
  parseProjectSettings,
  projectFromPath,
  validateProjectSettings,
} from "../../src/engine";
import demoText from "../../projects/demo/project.json?raw";

describe("project ids and paths", () => {
  it("accepts letters, digits, _ and -, nothing that could be a path", () => {
    for (const id of ["demo", "My_Game2", "level-1"]) expect(isProjectId(id)).toBe(true);
    for (const id of ["", "my game", "../demo", "a/b", "-x", ".hidden"]) expect(isProjectId(id)).toBe(false);
  });

  it("reads the project and the file inside it from a path", () => {
    expect(projectFromPath("/projects/demo/scenes/play.json")).toEqual({ id: "demo", file: "scenes/play.json" });
    expect(projectFromPath("projects/demo/project.json")).toEqual({ id: "demo", file: "project.json" });
    expect(projectFromPath("/src/projects/x/a.js")).toEqual({ id: "x", file: "a.js" });
    expect(projectFromPath("/projects/my game/a.js")).toBeNull();
    expect(projectFromPath("/projects/demo")).toBeNull();
    expect(projectFromPath("/elsewhere/demo/a.js")).toBeNull();
  });
});

describe("project settings", () => {
  const full = {
    name: "Demo",
    width: 800,
    height: 600,
    pixelArt: true,
    gravity: { x: 0, y: 980 },
    collisionLayers: { player: { solid: ["world"], touch: ["toy"] }, toy: { solid: ["world", "toy"] } },
    scenes: ["title", "play"],
    firstScene: "title",
  };

  it("checks settings and fills in what is optional", () => {
    expect(validateProjectSettings(full)).toEqual(full);
    expect(validateProjectSettings({ width: 320, height: 240, scenes: ["main"], firstScene: "main" })).toEqual({
      name: "",
      width: 320,
      height: 240,
      pixelArt: false,
      gravity: { x: 0, y: 0 },
      collisionLayers: {},
      scenes: ["main"],
      firstScene: "main",
    });
    expect(validateProjectSettings({ width: 1, height: 1, scenes: [] }).firstScene).toBe("");
    expect(validateProjectSettings({ ...full, collisionLayers: { a: {} } }).collisionLayers).toEqual({ a: {} });
  });

  it("returns a fresh copy", () => {
    const checked = validateProjectSettings(full);
    expect(checked.scenes).not.toBe(full.scenes);
    expect(checked.collisionLayers.player.solid).not.toBe(full.collisionLayers.player.solid);
  });

  it.each([
    [null, "Project settings must be an object"],
    [{ ...full, name: 5 }, '"name" must be a string'],
    [{ ...full, width: 0 }, '"width" and "height" must be positive whole numbers'],
    [{ ...full, height: 1.5 }, '"width" and "height" must be positive whole numbers'],
    [{ ...full, pixelArt: "yes" }, '"pixelArt" must be true or false'],
    [{ ...full, gravity: 9 }, '"gravity" must be an object'],
    [{ ...full, gravity: { y: "down" } }, '"gravity" must have numbers'],
    [{ ...full, collisionLayers: [] }, '"collisionLayers" must be an object of layers'],
    [{ ...full, collisionLayers: { a: 1 } }, 'Layer "a" must be an object'],
    [{ ...full, collisionLayers: { a: { solid: "b" } } }, 'Layer "a": "solid" and "touch" must be lists'],
    [{ ...full, scenes: "title" }, '"scenes" must be a list of scene names, each once'],
    [{ ...full, scenes: ["a", "a"] }, '"scenes" must be a list of scene names, each once'],
    [{ ...full, firstScene: "nope" }, '"firstScene" must be one of the scenes'],
  ])("rejects %j", (value, message) => {
    expect(() => validateProjectSettings(value)).toThrow(message);
  });

  it("parses a settings file's text, reporting bad JSON", () => {
    expect(parseProjectSettings(JSON.stringify(full))).toEqual(full);
    expect(() => parseProjectSettings("{oops")).toThrow(/^not valid JSON: /);
  });

  it("starts a new project with one empty scene and gravity on", () => {
    expect(newProjectSettings("My Game")).toEqual({
      name: "My Game",
      width: 800,
      height: 600,
      pixelArt: true,
      gravity: { x: 0, y: 980 },
      collisionLayers: {},
      scenes: ["main"],
      firstScene: "main",
    });
  });

  it("writes settings one per line, reproducing the demo's project.json exactly", () => {
    expect(formatProjectSettings(parseProjectSettings(demoText))).toBe(demoText.replace(/\r\n/g, "\n"));
    expect(formatProjectSettings(newProjectSettings("X"))).toBe(
      '{\n  "name": "X",\n  "width": 800,\n  "height": 600,\n  "pixelArt": true,\n' +
        '  "gravity": { "x": 0, "y": 980 },\n  "collisionLayers": {},\n  "scenes": ["main"],\n  "firstScene": "main"\n}\n',
    );
    expect(formatProjectSettings({ ...newProjectSettings("X"), collisionLayers: { a: {} } })).toContain('    "a": {}\n');
  });
});
