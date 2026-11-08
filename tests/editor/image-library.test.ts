import { describe, expect, it } from "vitest";
import { ImageLibrary, READ_ONLY } from "../../src/editor/image-library";
import { Assets, type ImageFile, type StoredSheet } from "../../src/engine";
import { FakeImageFiles } from "../helpers/fake-image-files";

function fakeImage(width: number, height: number): HTMLImageElement {
  return { width, height } as HTMLImageElement;
}

const HERO_SHEET: StoredSheet = {
  frameWidth: 16,
  frameHeight: 16,
  animations: { idle: { frames: [0, 1], fps: 2 } },
};

/**
 * A library over fake image files, starting with "hero", a 64x32 sheet. `file(w, h)`
 * makes a PNG file that decodes as a w x h image; `junk()` makes a PNG file that
 * doesn't decode.
 */
function setup(options: { reachable?: boolean; fallback?: readonly ImageFile[] } = {}) {
  const sizes = new Map<Blob, [number, number]>();
  const files = new FakeImageFiles();
  files.reachable = options.reachable ?? true;
  const assets = new Assets(async (url) => {
    if (url === "/hero.png") return fakeImage(64, 32);
    const size = sizes.get(files.fileOf(url)!);
    if (!size) throw new Error("not an image");
    return fakeImage(...size);
  });
  const library = new ImageLibrary({
    files,
    fallback: options.fallback && (async () => options.fallback!),
    assets,
  });
  let changes = 0;
  library.onChange(() => changes++);
  const file = (width: number, height: number) => {
    const blob = new Blob(["x"], { type: "image/png" });
    sizes.set(blob, [width, height]);
    return blob;
  };
  const junk = () => new Blob(["not an image"], { type: "image/png" });
  files.put("hero", file(64, 32), HERO_SHEET);
  return { library, assets, files, file, junk, changes: () => changes };
}

describe("ImageLibrary.load", () => {
  it("loads the image files into Assets", async () => {
    const ctx = setup();
    ctx.files.put("slime", ctx.file(64, 32), {
      frameWidth: 32,
      frameHeight: 32,
      animations: { wobble: { frames: [0, 1], fps: 4 } },
    });
    ctx.files.put("coin", ctx.file(8, 8));
    await ctx.library.load();
    expect(ctx.library.names).toEqual(["coin", "hero", "slime"]);
    expect(ctx.assets.frameCount("hero")).toBe(8);
    expect(ctx.assets.frameCount("slime")).toBe(2);
    expect(ctx.assets.getAnimation("slime", "wobble").fps).toBe(4);
    expect(ctx.changes()).toBe(1);
  });

  it("describes the images", async () => {
    const ctx = setup();
    ctx.files.put("coin", ctx.file(8, 6));
    await ctx.library.load();
    expect(ctx.library.image("hero")).toEqual({
      name: "hero",
      sheet: { frameWidth: 16, frameHeight: 16, animations: { idle: { frames: [0, 1], fps: 2 } } },
      width: 64,
      height: 32,
      frameCount: 8,
      error: null,
    });
    expect(ctx.library.image("coin")).toEqual({
      name: "coin",
      sheet: null,
      width: 8,
      height: 6,
      frameCount: 1,
      error: null,
    });
    expect(ctx.library.has("coin")).toBe(true);
    expect(ctx.library.has("nope")).toBe(false);
    expect(() => ctx.library.image("nope")).toThrow('Image "nope" not found');
  });

  it("keeps an image file that fails to load, with its error, and loads the rest", async () => {
    const ctx = setup();
    ctx.files.put("broken", ctx.junk());
    ctx.files.put("coin", ctx.file(8, 8));
    ctx.files.put("torn", ctx.file(8, 8));
    ctx.files.errors.set("torn", "torn.json: not valid JSON");
    await ctx.library.load();
    expect(ctx.library.names).toEqual(["broken", "coin", "hero", "torn"]);
    expect(ctx.library.image("broken").error).toContain('Failed to load image "broken"');
    expect(ctx.library.image("broken").width).toBeNull();
    expect(ctx.library.image("torn").error).toBe("torn.json: not valid JSON");
    expect(ctx.assets.hasImage("torn")).toBe(false);
    expect(ctx.assets.hasImage("coin")).toBe(true);
  });

  it("falls back to the bundled images, read-only, when the files can't be reached", async () => {
    const ctx = setup({ reachable: false, fallback: [{ name: "coin", url: "/hero.png" }] });
    await ctx.library.load();
    expect(ctx.library.available).toBe(false);
    expect(ctx.library.names).toEqual(["coin"]);
    expect(ctx.library.image("coin").width).toBe(64);
    await expect(ctx.library.add(ctx.file(8, 8), "x.png")).rejects.toThrow(READ_ONLY);
    await expect(ctx.library.remove("coin")).rejects.toThrow(READ_ONLY);
    await expect(ctx.library.setFrameSize("coin", 8, 8)).rejects.toThrow(READ_ONLY);
    await expect(ctx.library.importImage("coin", ctx.file(8, 8), null)).rejects.toThrow(READ_ONLY);
    await ctx.library.reload();
    expect(ctx.files.calls).toEqual(["load"]);
  });

  it("rejects when the files can't be reached and there is no fallback", async () => {
    const ctx = setup({ reachable: false });
    await expect(ctx.library.load()).rejects.toThrow("/api/images is not there");
  });
});

describe("ImageLibrary.add", () => {
  it("writes the file as a single image named after it, and loads it", async () => {
    const ctx = setup();
    await ctx.library.load();
    const file = ctx.file(32, 16);
    expect(await ctx.library.add(file, "Slime Sheet.png")).toBe("slime-sheet");
    expect(ctx.library.names).toEqual(["hero", "slime-sheet"]);
    expect(ctx.files.images.get("slime-sheet")).toMatchObject({ file, sheet: null });
    expect(ctx.assets.getImage("slime-sheet").width).toBe(32);
    expect(ctx.changes()).toBe(2);
  });

  it("never reuses a name", async () => {
    const ctx = setup();
    await ctx.library.load();
    expect(await ctx.library.add(ctx.file(8, 8), "hero.png")).toBe("hero-2");
    expect(await ctx.library.add(ctx.file(8, 8), "hero.png")).toBe("hero-3");
  });

  it("rejects a file that isn't an image, and takes it out of the files again", async () => {
    const ctx = setup();
    await ctx.library.load();
    await expect(ctx.library.add(ctx.junk(), "notes.png")).rejects.toThrow(
      "Couldn't read notes.png as an image",
    );
    expect(ctx.library.names).toEqual(["hero"]);
    expect(ctx.files.images.size).toBe(1);
    expect(ctx.assets.hasImage("notes")).toBe(false);
    expect(ctx.changes()).toBe(1);
  });

  it("rejects a file of a type that isn't an image", async () => {
    const ctx = setup();
    await ctx.library.load();
    const text = new Blob(["hi"], { type: "text/plain" });
    await expect(ctx.library.add(text, "notes.txt")).rejects.toThrow(
      'Couldn\'t save image: Unsupported image type "text/plain"',
    );
    expect(ctx.files.images.size).toBe(1);
  });

  it("rejects when the files fail, and keeps nothing", async () => {
    const ctx = setup();
    await ctx.library.load();
    ctx.files.failure = "disk full";
    await expect(ctx.library.add(ctx.file(8, 8), "coin.png")).rejects.toThrow(
      "Couldn't save image: disk full",
    );
    expect(ctx.library.names).toEqual(["hero"]);
    expect(ctx.assets.hasImage("coin")).toBe(false);
  });

  it("runs writes one at a time, each seeing the previous one", async () => {
    const ctx = setup();
    await ctx.library.load();
    const names = await Promise.all([
      ctx.library.add(ctx.file(8, 8), "coin.png"),
      ctx.library.add(ctx.file(8, 8), "coin.png"),
    ]);
    expect(names).toEqual(["coin", "coin-2"]);
  });

  it("keeps working after a failed write", async () => {
    const ctx = setup();
    await ctx.library.load();
    const failed = ctx.library.add(ctx.junk(), "a.png");
    const added = ctx.library.add(ctx.file(8, 8), "coin.png");
    await expect(failed).rejects.toThrow();
    expect(await added).toBe("coin");
  });
});

describe("ImageLibrary.remove", () => {
  it("deletes an image file from the files, the list and Assets", async () => {
    const ctx = setup();
    await ctx.library.load();
    await ctx.library.add(ctx.file(8, 8), "coin.png");
    await ctx.library.remove("coin");
    expect(ctx.library.names).toEqual(["hero"]);
    expect(ctx.files.images.has("coin")).toBe(false);
    expect(ctx.assets.hasImage("coin")).toBe(false);
    expect(ctx.changes()).toBe(3);
  });

  it("can delete an image that failed to load", async () => {
    const ctx = setup();
    ctx.files.put("broken", ctx.junk());
    await ctx.library.load();
    await ctx.library.remove("broken");
    expect(ctx.library.names).toEqual(["hero"]);
  });

  it("refuses unknown names", async () => {
    const ctx = setup();
    await ctx.library.load();
    await expect(ctx.library.remove("nope")).rejects.toThrow('Image "nope" not found');
  });

  it("keeps the image when the files fail", async () => {
    const ctx = setup();
    await ctx.library.load();
    await ctx.library.add(ctx.file(8, 8), "coin.png");
    ctx.files.failure = "blocked";
    await expect(ctx.library.remove("coin")).rejects.toThrow("Couldn't delete image: blocked");
    expect(ctx.library.names).toEqual(["coin", "hero"]);
    expect(ctx.assets.hasImage("coin")).toBe(true);
  });
});

/** A loaded library with "slime", a 64x32 single image. */
async function withSlime() {
  const ctx = setup();
  await ctx.library.load();
  await ctx.library.add(ctx.file(64, 32), "slime.png");
  return ctx;
}

describe("ImageLibrary.setFrameSize", () => {
  it("makes a single image a sheet, and back", async () => {
    const ctx = await withSlime();
    await ctx.library.setFrameSize("slime", 16, 16);
    expect(ctx.files.sheetOf("slime")).toEqual({
      frameWidth: 16,
      frameHeight: 16,
      animations: {},
    });
    expect(ctx.assets.frameCount("slime")).toBe(8);
    expect(ctx.library.image("slime").sheet?.frameWidth).toBe(16);

    await ctx.library.setFrameSize("slime", null, null);
    expect(ctx.files.sheetOf("slime")).toBeNull();
    expect(ctx.library.image("slime").sheet).toBeNull();
    expect(ctx.assets.frameCount("slime")).toBe(1);
    expect(ctx.files.calls.filter((call) => call.startsWith("sheet"))).toEqual(["sheet slime", "sheet slime"]);
  });

  it("rejects only one of width and height", async () => {
    const ctx = await withSlime();
    await expect(ctx.library.setFrameSize("slime", 16, null)).rejects.toThrow(
      "Set both frame width and height, or neither",
    );
    expect(ctx.files.sheetOf("slime")).toBeNull();
  });

  it("rejects a frame larger than the image, leaving the files and Assets alone", async () => {
    const ctx = await withSlime();
    await ctx.library.setFrameSize("slime", 16, 16);
    await expect(ctx.library.setFrameSize("slime", 64, 64)).rejects.toThrow(
      'Image "slime" (64x32) is smaller than one 64x64 frame',
    );
    expect(ctx.files.sheetOf("slime")?.frameWidth).toBe(16);
    expect(ctx.assets.frameCount("slime")).toBe(8);
  });

  it("rejects a frame size that leaves a clip out of range", async () => {
    const ctx = await withSlime();
    await ctx.library.setFrameSize("slime", 16, 16);
    await ctx.library.addClip("slime");
    await ctx.library.updateClip("slime", "clip", { frames: [7] });
    await expect(ctx.library.setFrameSize("slime", 32, 32)).rejects.toThrow(
      'Animation "clip" of image "slime": frame 7 is out of range (2 frames)',
    );
    expect(ctx.assets.frameCount("slime")).toBe(8);
  });

  it("won't drop clips by making a sheet a single image", async () => {
    const ctx = await withSlime();
    await ctx.library.setFrameSize("slime", 16, 16);
    await ctx.library.addClip("slime");
    await expect(ctx.library.setFrameSize("slime", null, null)).rejects.toThrow(
      "Remove the clips before making this a single image",
    );
    expect(ctx.files.sheetOf("slime")?.animations).toHaveProperty("clip");
  });
});

describe("ImageLibrary clips", () => {
  async function withSheet() {
    const ctx = await withSlime();
    await ctx.library.setFrameSize("slime", 16, 16);
    return ctx;
  }

  it("needs a frame size first", async () => {
    const ctx = await withSlime();
    await expect(ctx.library.addClip("slime")).rejects.toThrow(
      "Set a frame size before adding clips",
    );
  });

  it("adds clip, clip-2… playing frame 0 at 8 fps, looping", async () => {
    const ctx = await withSheet();
    expect(await ctx.library.addClip("slime")).toBe("clip");
    expect(await ctx.library.addClip("slime")).toBe("clip-2");
    expect(ctx.files.sheetOf("slime")?.animations).toEqual({
      clip: { frames: [0], fps: 8, loop: true },
      "clip-2": { frames: [0], fps: 8, loop: true },
    });
    expect(ctx.assets.getAnimation("slime", "clip-2")).toEqual({ frames: [0], fps: 8, loop: true });
  });

  it("updates frames, fps and loop", async () => {
    const ctx = await withSheet();
    await ctx.library.addClip("slime");
    await ctx.library.updateClip("slime", "clip", { frames: [1, 7], fps: 12, loop: false });
    expect(ctx.assets.getAnimation("slime", "clip")).toEqual({ frames: [1, 7], fps: 12, loop: false });
    expect(ctx.files.sheetOf("slime")?.animations.clip).toEqual({
      frames: [1, 7],
      fps: 12,
      loop: false,
    });
  });

  it("renames a clip in place, keeping the order", async () => {
    const ctx = await withSheet();
    await ctx.library.addClip("slime");
    await ctx.library.addClip("slime");
    await ctx.library.updateClip("slime", "clip", { name: "walk" });
    expect(Object.keys(ctx.library.image("slime").sheet?.animations ?? {})).toEqual([
      "walk",
      "clip-2",
    ]);
    expect(ctx.assets.hasAnimation("slime", "clip")).toBe(false);
    expect(ctx.assets.hasAnimation("slime", "walk")).toBe(true);
  });

  it.each([
    [{ frames: [8] }, 'Animation "clip" of image "slime": frame 8 is out of range (8 frames)'],
    [{ frames: [] }, 'Animation "clip" of image "slime" has no frames'],
    [{ fps: 0 }, 'Animation "clip" of image "slime" has invalid fps (0)'],
    [{ fps: NaN }, 'Animation "clip" of image "slime" has invalid fps (NaN)'],
    [{ name: "" }, "Clip name can't be empty"],
    [{ name: "clip-2" }, 'Clip "clip-2" already exists'],
  ])("rejects %o and changes nothing", async (changes, message) => {
    const ctx = await withSheet();
    await ctx.library.addClip("slime");
    await ctx.library.addClip("slime");
    const before = structuredClone(ctx.files.sheetOf("slime"));
    await expect(ctx.library.updateClip("slime", "clip", changes)).rejects.toThrow(message);
    expect(ctx.files.sheetOf("slime")).toEqual(before);
    expect(ctx.library.image("slime").sheet).toEqual(before);
    expect(ctx.assets.getAnimation("slime", "clip")).toEqual({ frames: [0], fps: 8, loop: true });
  });

  it("rejects an unknown clip", async () => {
    const ctx = await withSheet();
    await expect(ctx.library.updateClip("slime", "nope", { fps: 1 })).rejects.toThrow(
      'Clip "nope" not found',
    );
    await expect(ctx.library.removeClip("slime", "nope")).rejects.toThrow('Clip "nope" not found');
  });

  it("removes a clip", async () => {
    const ctx = await withSheet();
    await ctx.library.addClip("slime");
    await ctx.library.removeClip("slime", "clip");
    expect(ctx.files.sheetOf("slime")?.animations).toEqual({});
    expect(ctx.assets.hasAnimation("slime", "clip")).toBe(false);
  });

  it("applies quick successive edits in order", async () => {
    const ctx = await withSheet();
    await Promise.all([
      ctx.library.addClip("slime"),
      ctx.library.addClip("slime"),
      ctx.library.updateClip("slime", "clip", { fps: 3 }),
      ctx.library.removeClip("slime", "clip-2"),
    ]);
    expect(ctx.files.sheetOf("slime")?.animations).toEqual({
      clip: { frames: [0], fps: 3, loop: true },
    });
  });
});

describe("ImageLibrary edits that are refused", () => {
  it("refuses to edit an image that failed to load", async () => {
    const ctx = setup();
    ctx.files.put("broken", ctx.junk());
    await ctx.library.load();
    await expect(ctx.library.setFrameSize("broken", 8, 8)).rejects.toThrow(
      'Image "broken" could not be loaded; delete it and add it again',
    );
  });

  it("keeps the last saved version when the files fail", async () => {
    const ctx = await withSlime();
    await ctx.library.setFrameSize("slime", 16, 16);
    ctx.files.failure = "disk full";
    await expect(ctx.library.setFrameSize("slime", 32, 32)).rejects.toThrow(
      "Couldn't save image: disk full",
    );
    expect(ctx.library.image("slime").sheet?.frameWidth).toBe(16);
    expect(ctx.assets.frameCount("slime")).toBe(8);
    ctx.files.failure = null;
    expect(ctx.files.sheetOf("slime")?.frameWidth).toBe(16);
  });
});

describe("ImageLibrary.reload", () => {
  it("loads an image another program wrote, and drops one it removed", async () => {
    const ctx = setup();
    await ctx.library.load();
    const before = ctx.changes();
    // The other program wrote straight to the files.
    ctx.files.put("coin", ctx.file(8, 8));
    await ctx.library.reload(["coin"]);
    expect(ctx.library.names).toEqual(["coin", "hero"]);
    expect(ctx.library.image("coin").width).toBe(8);
    expect(ctx.changes()).toBe(before + 1);

    ctx.files.put("coin", ctx.file(12, 12));
    await ctx.library.reload(["coin"]);
    expect(ctx.library.image("coin").width).toBe(12);

    ctx.files.images.delete("coin");
    await ctx.library.reload(["coin"]);
    expect(ctx.library.names).toEqual(["hero"]);
    expect(ctx.assets.hasImage("coin")).toBe(false);
  });

  it("re-reads only the named images, or every image when no names are given", async () => {
    const ctx = setup();
    ctx.files.put("coin", ctx.file(8, 8));
    await ctx.library.load();
    ctx.files.put("coin", ctx.file(16, 16));
    ctx.files.put("slime", ctx.file(4, 4));
    await ctx.library.reload(["slime"]);
    expect(ctx.library.image("coin").width).toBe(8);
    expect(ctx.library.names).toEqual(["coin", "hero", "slime"]);
    await ctx.library.reload();
    expect(ctx.library.image("coin").width).toBe(16);
    expect(ctx.assets.frameCount("hero")).toBe(8);
  });

  it("keeps a reloaded image that fails to load, with its error", async () => {
    const ctx = setup();
    await ctx.library.load();
    ctx.files.put("coin", ctx.junk());
    await ctx.library.reload(["coin"]);
    expect(ctx.library.names).toEqual(["coin", "hero"]);
    expect(ctx.library.image("coin").error).toContain('Failed to load image "coin"');
    expect(ctx.assets.hasImage("coin")).toBe(false);
    ctx.files.put("coin", ctx.file(8, 8));
    await ctx.library.reload(["coin"]);
    expect(ctx.library.image("coin").error).toBeNull();
    expect(ctx.assets.hasImage("coin")).toBe(true);
  });

  it("waits for writes that are on their way", async () => {
    const ctx = setup();
    await ctx.library.load();
    const added = ctx.library.add(ctx.file(8, 8), "coin.png");
    const reloaded = ctx.library.reload(["coin"]);
    await Promise.all([added, reloaded]);
    expect(ctx.library.names).toEqual(["coin", "hero"]);
    expect(ctx.assets.hasImage("coin")).toBe(true);
  });
});

describe("ImageLibrary.importImage", () => {
  it("writes the file with its sheet, replacing an image of that name, and loads it", async () => {
    const ctx = setup();
    ctx.files.put("coin", ctx.file(8, 8));
    await ctx.library.load();
    const sheet = { frameWidth: 16, frameHeight: 16, animations: { spin: { frames: [0, 1], fps: 4 } } };
    await ctx.library.importImage("coin", ctx.file(32, 16), sheet);
    expect(ctx.files.sheetOf("coin")).toEqual(sheet);
    expect(ctx.assets.frameCount("coin")).toBe(2);
    await ctx.library.importImage("slime", ctx.file(8, 8), null);
    expect(ctx.library.names).toEqual(["coin", "hero", "slime"]);
  });
});
