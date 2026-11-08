import { describe, expect, it } from "vitest";
import { collectProjects } from "../../src/project/collect";
import { bundledProjects } from "../../src/project/bundle";

describe("collectProjects", () => {
  it("groups the globs' files by project, keeping only folders with a project.json", () => {
    const projects = collectProjects({
      settings: { "/projects/demo/project.json": "{}", "/projects/zoo/project.json": "{}" },
      scripts: {
        "/projects/demo/scripts/systems/b.js": "b",
        "/projects/demo/scripts/systems/a.js": "a",
        "/projects/demo/scripts/scenes/play.js": "p",
        "/projects/stray/scripts/systems/x.js": "x",
      },
      orders: { "/projects/demo/scripts/order.json": JSON.stringify({ systems: ["b"] }) },
      scenes: { "/projects/demo/scenes/play.json": "play", "/projects/zoo/scenes/main.json": "main" },
      images: { "/projects/demo/images/hero.svg": "/projects/demo/images/hero.svg" },
      sheets: { "/projects/demo/images/hero.json": '{"frameWidth": 2, "frameHeight": 2}' },
    });
    expect(Object.keys(projects)).toEqual(["demo", "zoo"]);
    expect(projects.demo.scripts.map((s) => `${s.kind}:${s.name}`)).toEqual(["system:b", "system:a", "scene:play"]);
    expect(projects.demo.sceneFiles).toEqual([{ name: "play", text: "play" }]);
    expect(projects.demo.imageFiles).toEqual([
      { name: "hero", url: "/projects/demo/images/hero.svg", sheet: { frameWidth: 2, frameHeight: 2, animations: {} } },
    ]);
    expect(projects.zoo).toEqual({ id: "zoo", settingsText: "{}", scripts: [], sceneFiles: [{ name: "main", text: "main" }], imageFiles: [] });
  });

  it("copes with a broken order file", () => {
    const projects = collectProjects({
      settings: { "/projects/demo/project.json": "{}" },
      scripts: { "/projects/demo/scripts/systems/b.js": "b", "/projects/demo/scripts/systems/a.js": "a" },
      orders: { "/projects/demo/scripts/order.json": "{oops" },
      scenes: {},
      images: {},
      sheets: {},
    });
    expect(projects.demo.scripts.map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("bundles the projects folder: the demo with its scripts, scenes and images", () => {
    const demo = bundledProjects.demo;
    expect(demo.scripts.map((s) => s.kind === "scene" ? `scene:${s.name}` : s.name)).toContain("scene:play");
    expect(demo.sceneFiles.map((f) => f.name)).toEqual(["play", "title"]);
    expect(demo.imageFiles.map((i) => i.name)).toEqual(["background", "hero"]);
    // In Vitest the URL is the path; in a build it may be the file inlined.
    expect(demo.imageFiles[1].url).toMatch(/hero\.svg|^data:image\/svg\+xml/);
  });
});
