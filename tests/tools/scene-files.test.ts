import { describe, expect, it } from "vitest";
import { formatSceneData, type SceneData } from "../../src/engine";
import { handleScenesRequest, SceneFiles } from "../../tools/scene-files";
import { MemoryFiles } from "../helpers/memory-files";

const ROOT = "src/game/scenes";
const data: SceneData = { version: 1, entities: [{ name: "Hero", components: { Transform: { x: 1, y: 2 } } }] };

function setup(extra: Record<string, string> = {}) {
  const fs = new MemoryFiles({
    [`${ROOT}/title.json`]: "title text",
    [`${ROOT}/play.json`]: "play text",
    [`${ROOT}/play.ts`]: "export const playScene = {};",
    [`${ROOT}/index.ts`]: "glob",
    ...extra,
  });
  return { fs, files: new SceneFiles(ROOT, fs) };
}

describe("SceneFiles", () => {
  it("lists the scene files by name, with their text", async () => {
    const { files } = setup();
    expect(await files.list()).toEqual([
      { name: "play", text: "play text" },
      { name: "title", text: "title text" },
    ]);
    expect(await new SceneFiles("elsewhere", new MemoryFiles()).list()).toEqual([]);
  });

  it("writes a scene's file formatted, creating it or keeping its line endings", async () => {
    const { files, fs } = setup({ [`${ROOT}/play.json`]: '{\r\n  "version": 1,\r\n  "entities": []\r\n}\r\n' });
    await files.write("bonus", data);
    expect(fs.text(`${ROOT}/bonus.json`)).toBe(formatSceneData(data));
    await files.write("play", data);
    expect(fs.text(`${ROOT}/play.json`)).toBe(formatSceneData(data).replace(/\n/g, "\r\n"));
    await files.write("title", data);
    expect(fs.text(`${ROOT}/title.json`)).toBe(formatSceneData(data));
    expect(fs.log).toEqual([`write ${ROOT}/bonus.json`, `write ${ROOT}/play.json`, `write ${ROOT}/title.json`]);
  });

  it("refuses names that are not scene names (so no paths sneak in)", async () => {
    const { files } = setup();
    await expect(files.write("../../etc/passwd", data)).rejects.toThrow("not a valid scene name");
  });
});

describe("handleScenesRequest", () => {
  const call = (files: SceneFiles, method: string, path: string, body: unknown = "") =>
    handleScenesRequest(files, { method, path, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("GET lists the scene files", async () => {
    const { files } = setup();
    const response = await call(files, "GET", "/");
    expect(response).toEqual({
      status: 200,
      body: { version: 1, scenes: [{ name: "play", text: "play text" }, { name: "title", text: "title text" }] },
    });
    expect((await call(files, "GET", "")).status).toBe(200);
  });

  it("PUT writes a scene after checking the data's shape", async () => {
    const { files, fs } = setup();
    expect(await call(files, "PUT", "/play", { data })).toEqual({ status: 200, body: { ok: true } });
    expect(fs.text(`${ROOT}/play.json`)).toBe(formatSceneData(data));
  });

  it("rejects bad input with 400 and explains", async () => {
    const { files, fs } = setup();
    expect(await call(files, "PUT", "/play", "{nope")).toMatchObject({
      status: 400,
      body: { error: "The request body must be a JSON object" },
    });
    expect(await call(files, "PUT", "/play", { data: { version: 2, entities: [] } })).toMatchObject({
      status: 400,
      body: { error: '"data" must be scene data: Unsupported scene data version: 2' },
    });
    expect(await call(files, "PUT", "/play", { data: { version: 1, entities: [{ name: "x" }] } })).toMatchObject({
      status: 400,
      body: { error: '"data" must be scene data: Entity 0 must have a "name" string and a "components" object' },
    });
    expect(await call(files, "PUT", "/my scene", { data })).toMatchObject({ status: 400 });
    expect(await call(files, "POST", "/play", { data })).toMatchObject({ status: 404 });
    expect(await call(files, "PUT", "/a/b", { data })).toMatchObject({ status: 404 });
    expect(fs.text(`${ROOT}/play.json`)).toBe("play text");
  });

  it("DELETE deletes a scene's file", async () => {
    const { files, fs } = setup();
    expect(await call(files, "DELETE", "/play")).toEqual({ status: 200, body: { ok: true } });
    expect(fs.files.has(`${ROOT}/play.json`)).toBe(false);
    expect(await call(files, "DELETE", "/play")).toMatchObject({ status: 200 });
    expect(await call(files, "DELETE", "/../x")).toMatchObject({ status: 404 });
  });

  it("answers 500 with the message when the files fail", async () => {
    const { files, fs } = setup();
    fs.write = async () => {
      throw new Error("disk full");
    };
    expect(await call(files, "PUT", "/play", { data })).toEqual({ status: 500, body: { error: "disk full" } });
  });
});
