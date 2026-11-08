import { describe, expect, it } from "vitest";
import { formatStoredSheet } from "../../src/engine";
import { fromBase64, toBase64 } from "../../tools/api";
import { handleImagesRequest, ImageFiles } from "../../tools/image-files";
import { MemoryFiles } from "../helpers/memory-files";

const ROOT = "src/game/images";
const sheet = { frameWidth: 16, frameHeight: 16, animations: { walk: { frames: [0, 1], fps: 8 } } };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 128]);

function setup(extra: Record<string, string | Uint8Array> = {}) {
  const fs = new MemoryFiles({
    [`${ROOT}/hero.svg`]: "<svg/>",
    [`${ROOT}/hero.json`]: JSON.stringify(sheet),
    [`${ROOT}/coin.png`]: PNG,
    [`${ROOT}/torn.png`]: PNG,
    [`${ROOT}/torn.json`]: "{oops",
    [`${ROOT}/index.ts`]: "glob",
    [`${ROOT}/notes.txt`]: "not an image",
    ...extra,
  });
  return { fs, files: new ImageFiles(ROOT, fs) };
}

describe("base64", () => {
  it("round-trips bytes, in chunks for big files", () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    for (const bytes of [PNG, new Uint8Array(0), big]) expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(toBase64(new Uint8Array([104, 105]))).toBe("aGk=");
  });
});

describe("ImageFiles", () => {
  it("lists the images by name, with their sheets or the error in them", async () => {
    const { files } = setup();
    expect(await files.list()).toEqual([
      { name: "coin", file: "coin.png" },
      { name: "hero", file: "hero.svg", sheet },
      { name: "torn", file: "torn.png", error: expect.stringMatching(/^torn\.json: not valid JSON/) },
    ]);
    expect(await new ImageFiles("elsewhere", new MemoryFiles()).list()).toEqual([]);
  });

  it("reads an image file's bytes with its content type", async () => {
    const { files } = setup();
    expect(await files.read("coin.png")).toEqual({ bytes: PNG, type: "image/png" });
    expect((await files.read("hero.svg"))?.type).toBe("image/svg+xml");
    expect(await files.read("nope.png")).toBeNull();
    await expect(files.read("notes.txt")).rejects.toThrow("not an image file");
    await expect(files.read("../hero.svg")).rejects.toThrow("not an image file");
  });

  it("saves an image's file by its type, replacing its earlier file whatever the format, and its sheet", async () => {
    const { files, fs } = setup();
    await files.save("slime", "image/png", PNG, sheet);
    expect(fs.files.get(`${ROOT}/slime.png`)).toEqual(PNG);
    expect(JSON.parse(fs.text(`${ROOT}/slime.json`)!)).toEqual(sheet);
    expect(fs.text(`${ROOT}/slime.json`)).toMatch(/\n$/);

    await files.save("slime", "image/svg+xml", new TextEncoder().encode("<svg/>"), null);
    expect(fs.files.has(`${ROOT}/slime.png`)).toBe(false);
    expect(fs.files.has(`${ROOT}/slime.json`)).toBe(false);
    expect(await fs.read(`${ROOT}/slime.svg`)).toBe("<svg/>");

    await expect(files.save("slime", "text/plain", PNG, null)).rejects.toThrow('Unsupported image type "text/plain"');
    await expect(files.save("../x", "image/png", PNG, null)).rejects.toThrow("not a valid image name");
  });

  it("sets or deletes an existing image's sheet, keeping the file's line endings", async () => {
    const { files, fs } = setup({ [`${ROOT}/hero.json`]: JSON.stringify(sheet).replace("{", "{\r\n") });
    await files.setSheet("coin", sheet);
    expect(fs.text(`${ROOT}/coin.json`)).toBe(formatStoredSheet(sheet));
    await files.setSheet("hero", sheet);
    expect(fs.text(`${ROOT}/hero.json`)).toBe(formatStoredSheet(sheet).replace(/\n/g, "\r\n"));
    await files.setSheet("coin", null);
    expect(fs.files.has(`${ROOT}/coin.json`)).toBe(false);
    await expect(files.setSheet("nope", sheet)).rejects.toThrow('There is no image "nope"');
  });

  it("removes an image's files, whatever their format, and its sheet", async () => {
    const { files, fs } = setup({ [`${ROOT}/hero.png`]: PNG });
    await files.remove("hero");
    expect([...fs.files.keys()].filter((path) => path.includes("hero"))).toEqual([]);
    await files.remove("nope");
    expect(fs.files.has(`${ROOT}/coin.png`)).toBe(true);
  });
});

describe("handleImagesRequest", () => {
  const call = (files: ImageFiles, method: string, path: string, body: unknown = "") =>
    handleImagesRequest(files, { method, path, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("GET lists the images, and GET /files/<file> serves one", async () => {
    const { files } = setup();
    const list = await call(files, "GET", "");
    expect(list.status).toBe(200);
    expect((list.body as { images: unknown[] }).images).toHaveLength(3);
    expect(await call(files, "GET", "/files/coin.png")).toEqual({ status: 200, file: { bytes: PNG, type: "image/png" } });
    expect(await call(files, "GET", "/files/nope.png")).toMatchObject({ status: 404 });
    expect(await call(files, "GET", "/files/notes.txt")).toMatchObject({ status: 404 });
    expect(await call(files, "GET", "/files/..%2Fhero.svg")).toMatchObject({ status: 404 });
  });

  it("PUT an image with its sheet, PUT its sheet, and DELETE it", async () => {
    const { files, fs } = setup();
    const put = await call(files, "PUT", "/slime", { type: "image/png", data: toBase64(PNG), sheet });
    expect(put).toEqual({ status: 200, body: { ok: true } });
    expect(fs.files.get(`${ROOT}/slime.png`)).toEqual(PNG);
    expect(JSON.parse(fs.text(`${ROOT}/slime.json`)!)).toEqual(sheet);
    expect(await call(files, "PUT", "/slime/sheet", { sheet: null })).toMatchObject({ status: 200 });
    expect(fs.files.has(`${ROOT}/slime.json`)).toBe(false);
    expect(await call(files, "PUT", "/slime/sheet", { sheet: { frameWidth: 2, frameHeight: 2 } })).toMatchObject({ status: 200 });
    expect(JSON.parse(fs.text(`${ROOT}/slime.json`)!)).toEqual({ frameWidth: 2, frameHeight: 2, animations: {} });
    expect(await call(files, "DELETE", "/slime")).toMatchObject({ status: 200 });
    expect(fs.files.has(`${ROOT}/slime.png`)).toBe(false);
    expect(fs.files.has(`${ROOT}/slime.json`)).toBe(false);
  });

  it("rejects bad input with 400 and explains", async () => {
    const { files, fs } = setup();
    const count = fs.files.size;
    expect(await call(files, "PUT", "/slime", "{nope")).toMatchObject({ status: 400, body: { error: "The request body must be a JSON object" } });
    expect(await call(files, "PUT", "/slime", { type: "text/plain", data: "" })).toMatchObject({
      status: 400,
      body: { error: '"type" must be an image content type, e.g. "image/png"' },
    });
    expect(await call(files, "PUT", "/slime", { type: "image/png", data: "***" })).toMatchObject({
      status: 400,
      body: { error: '"data" must be the file as base64 text' },
    });
    expect(await call(files, "PUT", "/slime", { type: "image/png", data: 5 })).toMatchObject({ status: 400 });
    expect(await call(files, "PUT", "/slime", { type: "image/png", data: "", sheet: { frameWidth: 0 } })).toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('"sheet" must be a sheet layout or null') },
    });
    expect(await call(files, "PUT", "/coin/sheet", { sheet: "big" })).toMatchObject({ status: 400 });
    expect(await call(files, "PUT", "/my sprite", { type: "image/png", data: "" })).toMatchObject({ status: 400 });
    expect(await call(files, "PUT", "/nope/sheet", { sheet: null })).toMatchObject({ status: 500, body: { error: 'There is no image "nope"' } });
    expect(await call(files, "GET", "/coin")).toMatchObject({ status: 404 });
    expect(await call(files, "DELETE", "/coin/sheet")).toMatchObject({ status: 404 });
    expect(await call(files, "PUT", "/a/b/c", {})).toMatchObject({ status: 404 });
    expect(fs.files.size).toBe(count);
  });
});
