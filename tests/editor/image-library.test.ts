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
