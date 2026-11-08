import { describe, expect, it } from "vitest";
import type { ImageFile } from "../../src/engine";
import { READ_ONLY, SpriteLibrary } from "../../src/sprite-editor/sprite-library";
import { FakeImageFiles } from "../helpers/fake-image-files";

/**
 * A library over fake image files; image files "download" as the file behind their URL,
 * other URLs as a file holding the URL.
 */
function setup(options: { reachable?: boolean; fallback?: readonly ImageFile[] } = {}) {
  const files = new FakeImageFiles();
  files.reachable = options.reachable ?? true;
  const library = new SpriteLibrary({
    files,
    fallback: options.fallback && (async () => options.fallback!),
    fetchFile: async (url) => {
      const stored = files.fileOf(url);
      if (stored) return stored;
      if (!url.endsWith(".svg")) throw new Error("HTTP 404");
      return new Blob([url], { type: "image/svg+xml" });
    },
  });
  return { library, files };
}

const file = (text: string) => new Blob([text], { type: "image/png" });

describe("SpriteLibrary", () => {
  it("lists the image files by name", async () => {
    const { library, files } = setup();
    files.put("slime", file("8x8"));
    files.put("coin", file("4x4"));
    expect(await library.list()).toEqual(["coin", "slime"]);
    expect(library.available).toBe(true);
  });

  it("loads image files from their URLs, with their sheets", async () => {
    const sheet = { frameWidth: 4, frameHeight: 3, animations: { go: { frames: [0, 1], fps: 4 } } };
    const { library, files } = setup();
    files.put("slime", file("8x6"), sheet);
    files.put("coin", file("2x2"));
    files.put("torn", file("1x1"));
    files.errors.set("torn", "torn.json: not valid JSON");
    const slime = await library.load("slime");
    expect(await slime.file.text()).toBe("8x6");
    expect(slime.sheet).toEqual(sheet);
    expect((await library.load("coin")).sheet).toBeNull();
    await expect(library.load("nope")).rejects.toThrow('Image "nope" not found');
    await expect(library.load("torn")).rejects.toThrow("torn.json: not valid JSON");
  });

  it("plans against the files", async () => {
    const { library, files } = setup();
    files.put("slime", file("8x8"));
    expect((await library.plan("Slime")).replaces).toBe(true);
    expect((await library.plan("coin")).replaces).toBe(false);
  });

  it("writes the file under the planned name, with the sheet if any", async () => {
    const { library, files } = setup();
    const plan = await library.plan("Coin");
    await library.save(plan, file("3x2"), null);
    expect(await files.images.get("coin")!.file.text()).toBe("3x2");
    expect(files.sheetOf("coin")).toBeNull();

    const sheet = { frameWidth: 1, frameHeight: 2, animations: { go: { frames: [0, 1], fps: 4 } } };
    await library.save(plan, file("3x2"), sheet);
    expect(files.sheetOf("coin")).toEqual(sheet);
    expect(files.calls).toEqual(["load", "save coin", "save coin"]);
  });

  it("without the dev server lists the bundled images but can't save", async () => {
    const { library, files } = setup({
      reachable: false,
      fallback: [{ name: "coin", url: "/coin.svg" }],
    });
    expect(await library.list()).toEqual(["coin"]);
    expect(library.available).toBe(false);
    expect(await (await library.load("coin")).file.text()).toBe("/coin.svg");
    await expect(library.save(await library.plan("coin"), file("2x2"), null)).rejects.toThrow(READ_ONLY);
    expect(files.images.size).toBe(0);

    const none = setup({ reachable: false });
    await expect(none.library.list()).rejects.toThrow("/api/images is not there");
  });

  it("passes on the files' failures", async () => {
    const { library, files } = setup();
    const plan = await library.plan("coin");
    files.failure = "disk full";
    await expect(library.save(plan, file("2x2"), null)).rejects.toThrow("disk full");
    expect(files.images.size).toBe(0);
  });
});
