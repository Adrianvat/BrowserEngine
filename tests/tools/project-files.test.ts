import { describe, expect, it } from "vitest";
import { formatProjectSettings, newProjectSettings, parseProjectSettings, type SceneData } from "../../src/engine";
import { toBase64 } from "../../tools/api";
import { changeOf, handleProjectsRequest, ProjectFiles } from "../../tools/project-files";
import { MemoryFiles } from "../helpers/memory-files";

const ROOT = "projects";
const demo = formatProjectSettings({ ...newProjectSettings("Demo"), scenes: ["title", "play"], firstScene: "title" });

function setup() {
  const fs = new MemoryFiles({
    [`${ROOT}/demo/project.json`]: demo,
    [`${ROOT}/demo/scenes/play.json`]: "play text",
    [`${ROOT}/demo/scripts/systems/kick.js`]: "export default () => {};",
    [`${ROOT}/demo/scripts/order.json`]: JSON.stringify({ systems: ["kick"] }),
    [`${ROOT}/demo/images/coin.png`]: new Uint8Array([1, 2, 3]),
    [`${ROOT}/broken/project.json`]: "{oops",
    [`${ROOT}/notes.txt`]: "not a project",
    [`${ROOT}/empty-folder/readme.md`]: "no project.json here",
  });
  return { fs, files: new ProjectFiles(ROOT, fs) };
}

describe("ProjectFiles", () => {
  it("lists the folders with a project.json, by id, with the file's text", async () => {
    const { files } = setup();
    expect(await files.list()).toEqual([
      { id: "broken", text: "{oops" },
      { id: "demo", text: demo },
    ]);
    expect(await files.has("demo")).toBe(true);
    expect(await files.has("empty-folder")).toBe(false);
    expect(await new ProjectFiles("elsewhere", new MemoryFiles()).list()).toEqual([]);
  });

  it("creates a project with the starting settings and its one empty scene", async () => {
    const { files, fs } = setup();
    await files.create("my-game", "My Game");
    expect(parseProjectSettings(fs.text(`${ROOT}/my-game/project.json`)!)).toEqual(newProjectSettings("My Game"));
    expect(JSON.parse(fs.text(`${ROOT}/my-game/scenes/main.json`)!)).toEqual({ version: 1, entities: [] });
    await expect(files.create("demo", "Again")).rejects.toThrow('There is already a project "demo"');
    await expect(files.create("../x", "")).rejects.toThrow("not a valid project id");
  });

  it("removes a project and everything in it", async () => {
    const { files, fs } = setup();
    await files.remove("demo");
    expect([...fs.files.keys()].filter((path) => path.startsWith(`${ROOT}/demo/`))).toEqual([]);
    expect(fs.files.has(`${ROOT}/broken/project.json`)).toBe(true);
    await expect(files.remove("a/b")).rejects.toThrow("not a valid project id");
  });

  it("writes an existing project's settings, keeping the file's line endings", async () => {
    const { files, fs } = setup();
    fs.files.set(`${ROOT}/demo/project.json`, demo.replace(/\n/g, "\r\n"));
    const next = { ...newProjectSettings("Demo 2"), scenes: ["a"], firstScene: "a" };
    await files.writeSettings("demo", next);
    expect(fs.text(`${ROOT}/demo/project.json`)).toBe(formatProjectSettings(next).replace(/\n/g, "\r\n"));
    await expect(files.writeSettings("nope", next)).rejects.toThrow('There is no project "nope"');
  });

  it("gives each project's folders their own APIs", async () => {
    const { files } = setup();
    expect((await files.scripts("demo").list()).map((s) => s.name)).toEqual(["kick"]);
    expect(await files.scenes("demo").list()).toEqual([{ name: "play", text: "play text" }]);
    expect((await files.images("demo").list()).map((i) => i.name)).toEqual(["coin"]);
    expect(await files.scripts("nope").list()).toEqual([]);
  });
});

describe("handleProjectsRequest", () => {
  const call = (files: ProjectFiles, method: string, path: string, body: unknown = "") =>
    handleProjectsRequest(files, { method, path, body: typeof body === "string" ? body : JSON.stringify(body) });
  const data: SceneData = { version: 1, entities: [] };

  it("GET lists the projects, POST makes one, DELETE deletes one", async () => {
    const { files, fs } = setup();
    expect(await call(files, "GET", "")).toMatchObject({ status: 200, body: { version: 1, projects: [{ id: "broken" }, { id: "demo" }] } });
    expect(await call(files, "POST", "", { id: "new", name: "New" })).toEqual({ status: 200, body: { ok: true } });
    expect(fs.files.has(`${ROOT}/new/project.json`)).toBe(true);
    expect(await call(files, "POST", "/", { id: "new" })).toMatchObject({ status: 409 });
    expect(await call(files, "POST", "", { id: "my game" })).toMatchObject({ status: 400 });
    expect(await call(files, "POST", "", { id: "x", name: 5 })).toMatchObject({ status: 400 });
    expect(await call(files, "DELETE", "/new")).toEqual({ status: 200, body: { ok: true } });
    expect(fs.files.has(`${ROOT}/new/project.json`)).toBe(false);
    expect(await call(files, "DELETE", "/new")).toMatchObject({ status: 404 });
  });

  it("PUT /<id>/settings writes checked settings", async () => {
    const { files, fs } = setup();
    const settings = { ...newProjectSettings("Demo"), scenes: ["x"], firstScene: "x" };
    expect(await call(files, "PUT", "/demo/settings", { settings })).toEqual({ status: 200, body: { ok: true } });
    expect(fs.text(`${ROOT}/demo/project.json`)).toBe(formatProjectSettings(settings));
    expect(await call(files, "PUT", "/demo/settings", { settings: { width: 0 } })).toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('"settings" must be project settings') },
    });
    expect(await call(files, "PUT", "/nope/settings", { settings })).toMatchObject({ status: 404 });
    expect(await call(files, "GET", "/demo/settings")).toMatchObject({ status: 404 });
  });

  it("hands a project's scripts, scenes and images routes to their APIs", async () => {
    const { files, fs } = setup();
    expect(await call(files, "GET", "/demo/scripts")).toMatchObject({ status: 200, body: { version: 1 } });
    expect(await call(files, "PUT", "/demo/scripts/systems/bounce", { code: "x" })).toMatchObject({ status: 200 });
    expect(fs.text(`${ROOT}/demo/scripts/systems/bounce.js`)).toBe("x");
    expect(await call(files, "PUT", "/demo/scenes/play", { data })).toMatchObject({ status: 200 });
    expect(JSON.parse(fs.text(`${ROOT}/demo/scenes/play.json`)!)).toEqual(data);
    expect(await call(files, "GET", "/demo/images/")).toMatchObject({ status: 200, body: { images: [{ name: "coin" }] } });
    expect(await call(files, "GET", "/demo/images/files/coin.png")).toMatchObject({ status: 200, file: { type: "image/png" } });
    expect(await call(files, "PUT", "/demo/images/slime", { type: "image/png", data: toBase64(new Uint8Array([9])) })).toMatchObject({
      status: 200,
    });
    expect(fs.files.has(`${ROOT}/demo/images/slime.png`)).toBe(true);
    expect(await call(files, "GET", "/nope/scripts")).toMatchObject({ status: 404, body: { error: 'There is no project "nope"' } });
    expect(await call(files, "GET", "/my game/scripts")).toMatchObject({ status: 400 });
    expect(await call(files, "GET", "/demo/other")).toMatchObject({ status: 404 });
    expect(await call(files, "GET", "/demo")).toMatchObject({ status: 404 });
  });
});

describe("changeOf", () => {
  it("tells the project, folder and file of a changed path", () => {
    expect(changeOf("demo/scenes/play.json", "change")).toEqual({ project: "demo", folder: "scenes", event: "change", file: "play.json" });
    expect(changeOf("demo/scripts/systems/kick.js", "add")).toEqual({ project: "demo", folder: "scripts", event: "add", file: "systems/kick.js" });
    expect(changeOf("demo/project.json", "unlink")).toEqual({ project: "demo", folder: "settings", event: "unlink", file: "" });
    expect(changeOf("demo/readme.md", "add")).toBeNull();
    expect(changeOf("demo/scenes", "addDir")).toBeNull();
    expect(changeOf("notes.txt", "change")).toBeNull();
    expect(changeOf("my game/scenes/a.json", "change")).toBeNull();
  });
});
