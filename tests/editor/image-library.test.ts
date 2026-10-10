import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageLibrary } from "../../src/editor/image-library";
import { Assets, ImageStore, type ImageSource, type StoredImage } from "../../src/engine";
import { MemoryImageStorage } from "../helpers/memory-image-storage";

function fakeImage(width: number, height: number): HTMLImageElement {
  return { width, height } as HTMLImageElement;
}

const HERO: ImageSource = {
  url: "/hero.png",
  frameWidth: 16,
  frameHeight: 16,
  animations: { idle: { frames: [0, 1], fps: 2 } },
};

/**
 * A library over an in-memory store. `file(w, h)` makes a file that decodes as a
 * w x h image; `junk()` makes one that doesn't decode.
 */
function setup(
  options: { stored?: StoredImage[]; builtIns?: Record<string, ImageSource>; storage?: MemoryImageStorage | null } = {},
) {
  const images: Record<string, HTMLImageElement> = { "/hero.png": fakeImage(64, 32) };
  const sizes = new Map<Blob, [number, number]>();
  const storage = options.storage === undefined ? new MemoryImageStorage() : options.storage;
  for (const image of options.stored ?? []) storage?.images.set(image.name, image);
  const assets = new Assets(async (url) => {
    const image = images[url];
    if (!image) throw new Error("not an image");
    return image;
  });
  let next = 0;
  const library = new ImageLibrary({
    builtIns: options.builtIns ?? { hero: HERO },
    store: new ImageStore(storage),
    assets,
    createUrl: (file) => {
      const url = `blob:${++next}`;
      const size = sizes.get(file);
      if (size) images[url] = fakeImage(...size);
      return url;
    },
  });
  let changes = 0;
  library.onChange(() => changes++);
  const file = (width: number, height: number) => {
    const blob = new Blob(["x"], { type: "image/png" });
    sizes.set(blob, [width, height]);
    return blob;
  };
  const junk = () => new Blob(["not an image"], { type: "text/plain" });
  return { library, assets, storage, file, junk, changes: () => changes };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImageLibrary.load", () => {
  it("loads the built-ins and the stored images into Assets", async () => {
    const ctx = setup();
    const slime = ctx.file(64, 32);
    ctx.storage?.images.set("slime", {
      name: "slime",
      file: slime,
      sheet: { frameWidth: 32, frameHeight: 32, animations: { wobble: { frames: [0, 1], fps: 4 } } },
    });
    ctx.storage?.images.set("coin", { name: "coin", file: ctx.file(8, 8) });
    await ctx.library.load();
    expect(ctx.library.names).toEqual(["hero", "coin", "slime"]);
    expect(ctx.assets.frameCount("hero")).toBe(8);
    expect(ctx.assets.frameCount("slime")).toBe(2);
    expect(ctx.assets.getAnimation("slime", "wobble").fps).toBe(4);
    expect(ctx.changes()).toBe(1);
  });

  it("describes built-in and uploaded images", async () => {
    const ctx = setup();
    ctx.storage?.images.set("coin", { name: "coin", file: ctx.file(8, 6) });
    await ctx.library.load();
    expect(ctx.library.image("hero")).toEqual({
      name: "hero",
      builtIn: true,
      sheet: { frameWidth: 16, frameHeight: 16, animations: { idle: { frames: [0, 1], fps: 2 } } },
      width: 64,
      height: 32,
      frameCount: 8,
      error: null,
    });
    expect(ctx.library.image("coin")).toEqual({
      name: "coin",
      builtIn: false,
      sheet: null,
      width: 8,
      height: 6,
      frameCount: 1,
      error: null,
    });
    expect(ctx.library.isBuiltIn("hero")).toBe(true);
    expect(ctx.library.has("coin")).toBe(true);
    expect(ctx.library.has("nope")).toBe(false);
    expect(() => ctx.library.image("nope")).toThrow('Image "nope" not found');
  });

  it("keeps a stored image that fails to load, with its error, and loads the rest", async () => {
    const ctx = setup();
    ctx.storage?.images.set("broken", { name: "broken", file: ctx.junk() });
    ctx.storage?.images.set("coin", { name: "coin", file: ctx.file(8, 8) });
    await ctx.library.load();
    expect(ctx.library.names).toEqual(["hero", "broken", "coin"]);
    expect(ctx.library.image("broken").error).toContain('Failed to load image "broken"');
    expect(ctx.library.image("broken").width).toBeNull();
    expect(ctx.assets.hasImage("coin")).toBe(true);
  });

  it("ignores a stored image with a built-in's name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = setup();
    ctx.storage?.images.set("hero", { name: "hero", file: ctx.file(8, 8) });
    await ctx.library.load();
    expect(ctx.library.names).toEqual(["hero"]);
    expect(ctx.assets.frameCount("hero")).toBe(8);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("rejects when a built-in fails to load", async () => {
    const ctx = setup({ builtIns: { bad: "/missing.png" } });
    await expect(ctx.library.load()).rejects.toThrow('Failed to load image "bad"');
  });
});

describe("ImageLibrary.add", () => {
  it("stores the file as a single image named after it, and loads it", async () => {
    const ctx = setup();
    await ctx.library.load();
    const file = ctx.file(32, 16);
    expect(await ctx.library.add(file, "Slime Sheet.png")).toBe("slime-sheet");
    expect(ctx.library.names).toEqual(["hero", "slime-sheet"]);
    expect(ctx.storage?.images.get("slime-sheet")).toEqual({ name: "slime-sheet", file });
    expect(ctx.assets.getImage("slime-sheet").width).toBe(32);
    expect(ctx.changes()).toBe(2);
  });

  it("never reuses a name, built-in or uploaded", async () => {
    const ctx = setup();
    await ctx.library.load();
    expect(await ctx.library.add(ctx.file(8, 8), "hero.png")).toBe("hero-2");
    expect(await ctx.library.add(ctx.file(8, 8), "hero.png")).toBe("hero-3");
  });

  it("rejects a file that isn't an image and stores nothing", async () => {
    const ctx = setup();
    await ctx.library.load();
    await expect(ctx.library.add(ctx.junk(), "notes.txt")).rejects.toThrow(
      "Couldn't read notes.txt as an image",
    );
    expect(ctx.library.names).toEqual(["hero"]);
    expect(ctx.storage?.images.size).toBe(0);
    expect(ctx.assets.hasImage("notes")).toBe(false);
    expect(ctx.changes()).toBe(1);
  });

  it("rejects when the store fails, and keeps nothing", async () => {
    const ctx = setup();
    await ctx.library.load();
    ctx.storage!.failWith = "quota exceeded";
    await expect(ctx.library.add(ctx.file(8, 8), "coin.png")).rejects.toThrow(
      "Couldn't save image: quota exceeded",
    );
    expect(ctx.library.names).toEqual(["hero"]);
    expect(ctx.assets.hasImage("coin")).toBe(false);
  });

  it("rejects when the browser can't store images", async () => {
    const ctx = setup({ storage: null });
    await ctx.library.load();
    expect(ctx.library.available).toBe(false);
    await expect(ctx.library.add(ctx.file(8, 8), "coin.png")).rejects.toThrow(
      "Images can't be saved in this browser",
    );
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
    const failed = ctx.library.add(ctx.junk(), "a.txt");
    const added = ctx.library.add(ctx.file(8, 8), "coin.png");
    await expect(failed).rejects.toThrow();
    expect(await added).toBe("coin");
  });
});

describe("ImageLibrary.remove", () => {
  it("deletes an uploaded image from the store, the list and Assets", async () => {
    const ctx = setup();
    await ctx.library.load();
    await ctx.library.add(ctx.file(8, 8), "coin.png");
    await ctx.library.remove("coin");
    expect(ctx.library.names).toEqual(["hero"]);
    expect(ctx.storage?.images.has("coin")).toBe(false);
    expect(ctx.assets.hasImage("coin")).toBe(false);
    expect(ctx.changes()).toBe(3);
  });

  it("can delete an image that failed to load", async () => {
    const ctx = setup();
    ctx.storage?.images.set("broken", { name: "broken", file: ctx.junk() });
    await ctx.library.load();
    await ctx.library.remove("broken");
    expect(ctx.library.names).toEqual(["hero"]);
  });

  it("refuses built-ins and unknown names", async () => {
    const ctx = setup();
    await ctx.library.load();
    await expect(ctx.library.remove("hero")).rejects.toThrow(
      `Image "hero" is defined in code and can't be changed here`,
    );
    await expect(ctx.library.remove("nope")).rejects.toThrow('Image "nope" not found');
  });

  it("keeps the image when the store fails", async () => {
    const ctx = setup();
    await ctx.library.load();
    await ctx.library.add(ctx.file(8, 8), "coin.png");
    ctx.storage!.failWith = "blocked";
    await expect(ctx.library.remove("coin")).rejects.toThrow("Couldn't delete image: blocked");
    expect(ctx.library.names).toEqual(["hero", "coin"]);
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
    expect(ctx.storage?.images.get("slime")?.sheet).toEqual({
      frameWidth: 16,
      frameHeight: 16,
      animations: {},
    });
    expect(ctx.assets.frameCount("slime")).toBe(8);
    expect(ctx.library.image("slime").sheet?.frameWidth).toBe(16);

    await ctx.library.setFrameSize("slime", null, null);
    expect(ctx.storage?.images.get("slime")?.sheet).toBeUndefined();
    expect(ctx.assets.frameCount("slime")).toBe(1);
  });

  it("rejects only one of width and height", async () => {
    const ctx = await withSlime();
    await expect(ctx.library.setFrameSize("slime", 16, null)).rejects.toThrow(
      "Set both frame width and height, or neither",
    );
    expect(ctx.storage?.images.get("slime")?.sheet).toBeUndefined();
  });

  it("rejects a frame larger than the image, leaving the store and Assets alone", async () => {
    const ctx = await withSlime();
    await ctx.library.setFrameSize("slime", 16, 16);
    await expect(ctx.library.setFrameSize("slime", 64, 64)).rejects.toThrow(
      'Image "slime" (64x32) is smaller than one 64x64 frame',
    );
    expect(ctx.storage?.images.get("slime")?.sheet?.frameWidth).toBe(16);
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
    expect(ctx.storage?.images.get("slime")?.sheet?.animations).toHaveProperty("clip");
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
    expect(ctx.storage?.images.get("slime")?.sheet?.animations).toEqual({
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
    expect(ctx.storage?.images.get("slime")?.sheet?.animations.clip).toEqual({
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
    const before = structuredClone(ctx.storage?.images.get("slime")?.sheet);
    await expect(ctx.library.updateClip("slime", "clip", changes)).rejects.toThrow(message);
    expect(ctx.storage?.images.get("slime")?.sheet).toEqual(before);
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
    expect(ctx.storage?.images.get("slime")?.sheet?.animations).toEqual({});
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
    expect(ctx.storage?.images.get("slime")?.sheet?.animations).toEqual({
      clip: { frames: [0], fps: 3, loop: true },
    });
  });
});

describe("ImageLibrary edits that are refused", () => {
  it("refuses to edit a built-in", async () => {
    const ctx = setup();
    await ctx.library.load();
    const message = `Image "hero" is defined in code and can't be changed here`;
    await expect(ctx.library.setFrameSize("hero", 8, 8)).rejects.toThrow(message);
    await expect(ctx.library.addClip("hero")).rejects.toThrow(message);
    await expect(ctx.library.updateClip("hero", "idle", { fps: 1 })).rejects.toThrow(message);
    await expect(ctx.library.removeClip("hero", "idle")).rejects.toThrow(message);
  });

  it("refuses to edit an image that failed to load", async () => {
    const ctx = setup();
    ctx.storage?.images.set("broken", { name: "broken", file: ctx.junk() });
    await ctx.library.load();
    await expect(ctx.library.setFrameSize("broken", 8, 8)).rejects.toThrow(
      'Image "broken" could not be loaded; delete it and upload it again',
    );
  });

  it("keeps the last saved version when the store fails", async () => {
    const ctx = await withSlime();
    await ctx.library.setFrameSize("slime", 16, 16);
    ctx.storage!.failWith = "quota exceeded";
    await expect(ctx.library.setFrameSize("slime", 32, 32)).rejects.toThrow(
      "Couldn't save image: quota exceeded",
    );
    expect(ctx.library.image("slime").sheet?.frameWidth).toBe(16);
    expect(ctx.assets.frameCount("slime")).toBe(8);
    ctx.storage!.failWith = null;
    expect(ctx.storage?.images.get("slime")?.sheet?.frameWidth).toBe(16);
  });
});
