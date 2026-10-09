import { describe, it, expect } from "vitest";
import { Assets, type ImageLoader } from "../../src/engine/assets/assets";

function fakeImage(width: number, height: number): HTMLImageElement {
  return { width, height } as HTMLImageElement;
}

/** Serves fake images by URL; unknown URLs fail like a 404. */
function fakeLoader(files: Record<string, HTMLImageElement>): ImageLoader {
  return async (url) => {
    const image = files[url];
    if (!image) throw new Error(`404 ${url}`);
    return image;
  };
}

describe("Assets.loadImages", () => {
  it("loads a single image as one frame covering the whole image", async () => {
    const bg = fakeImage(50, 40);
    const assets = new Assets(fakeLoader({ "/bg.png": bg }));
    await assets.loadImages({ bg: "/bg.png" });
    expect(assets.hasImage("bg")).toBe(true);
    expect(assets.getImage("bg")).toBe(bg);
    expect(assets.frameCount("bg")).toBe(1);
    expect(assets.getFrame("bg", 0)).toEqual({ sx: 0, sy: 0, sw: 50, sh: 40 });
  });

  it("numbers sheet frames left to right, then top to bottom", async () => {
    const assets = new Assets(fakeLoader({ "/hero.png": fakeImage(64, 32) }));
    await assets.loadImages({ hero: { url: "/hero.png", frameWidth: 16, frameHeight: 16 } });
    expect(assets.frameCount("hero")).toBe(8);
    expect(assets.getFrame("hero", 0)).toEqual({ sx: 0, sy: 0, sw: 16, sh: 16 });
    expect(assets.getFrame("hero", 3)).toEqual({ sx: 48, sy: 0, sw: 16, sh: 16 });
    expect(assets.getFrame("hero", 5)).toEqual({ sx: 16, sy: 16, sw: 16, sh: 16 });
  });

  it("ignores partial frames at the right and bottom edges", async () => {
    const assets = new Assets(fakeLoader({ "/s.png": fakeImage(40, 20) }));
    await assets.loadImages({ s: { url: "/s.png", frameWidth: 16, frameHeight: 16 } });
    expect(assets.frameCount("s")).toBe(2);
    expect(assets.getFrame("s", 1)).toEqual({ sx: 16, sy: 0, sw: 16, sh: 16 });
  });

  it("loading a name again replaces it", async () => {
    const second = fakeImage(8, 8);
    const assets = new Assets(fakeLoader({ "/a.png": fakeImage(4, 4), "/b.png": second }));
    await assets.loadImages({ icon: "/a.png" });
    await assets.loadImages({ icon: "/b.png" });
    expect(assets.getImage("icon")).toBe(second);
  });

  it("rejects with the image name and URL when a file fails to load", async () => {
    const assets = new Assets(fakeLoader({}));
    await expect(assets.loadImages({ hero: "/hero.png" })).rejects.toThrow(
      'Failed to load image "hero" from /hero.png',
    );
  });

  it("includes the loader's reason in the error", async () => {
    const assets = new Assets(fakeLoader({}));
    await expect(assets.loadImages({ hero: "/hero.png" })).rejects.toThrow(
      'Failed to load image "hero" from /hero.png: 404 /hero.png',
    );
  });

  it("is all-or-nothing: one failure registers none of the batch, earlier loads survive", async () => {
    const assets = new Assets(fakeLoader({ "/old.png": fakeImage(8, 8), "/ok.png": fakeImage(8, 8) }));
    await assets.loadImages({ old: "/old.png" });
    await expect(
      assets.loadImages({ ok: "/ok.png", missing: "/missing.png" }),
    ).rejects.toThrow('Failed to load image "missing" from /missing.png');
    expect(assets.hasImage("ok")).toBe(false);
    expect(assets.hasImage("old")).toBe(true);
  });

  it("rejects an invalid frame size", async () => {
    const assets = new Assets(fakeLoader({ "/s.png": fakeImage(64, 64) }));
    for (const [frameWidth, frameHeight] of [[0, 16], [16, -1], [1.5, 16]]) {
      await expect(
        assets.loadImages({ s: { url: "/s.png", frameWidth, frameHeight } }),
      ).rejects.toThrow('Invalid frame size for image "s"');
    }
  });

  it("rejects a sheet smaller than one frame", async () => {
    const assets = new Assets(fakeLoader({ "/s.png": fakeImage(10, 10) }));
    await expect(
      assets.loadImages({ s: { url: "/s.png", frameWidth: 16, frameHeight: 16 } }),
    ).rejects.toThrow('Image "s" (10x10) is smaller than one 16x16 frame');
  });

  it("rejects a single image with no size (e.g. an SVG without width/height)", async () => {
    const assets = new Assets(fakeLoader({ "/logo.svg": fakeImage(0, 0) }));
    await expect(assets.loadImages({ logo: "/logo.svg" })).rejects.toThrow(
      'Image "logo" has no size (0x0)',
    );
  });
});

describe("Assets lookups", () => {
  it("unknown names throw", () => {
    const assets = new Assets(fakeLoader({}));
    expect(assets.hasImage("nope")).toBe(false);
    expect(() => assets.getImage("nope")).toThrow('Image "nope" is not loaded');
    expect(() => assets.frameCount("nope")).toThrow('Image "nope" is not loaded');
    expect(() => assets.getFrame("nope", 0)).toThrow('Image "nope" is not loaded');
  });

  it("out-of-range, negative, and non-integer frames throw", async () => {
    const assets = new Assets(
      fakeLoader({ "/hero.png": fakeImage(64, 32), "/bg.png": fakeImage(50, 40) }),
    );
    await assets.loadImages({
      hero: { url: "/hero.png", frameWidth: 16, frameHeight: 16 },
      bg: "/bg.png",
    });
    expect(() => assets.getFrame("hero", 8)).toThrow('Frame 8 is out of range for "hero" (8 frames)');
    expect(() => assets.getFrame("hero", -1)).toThrow('Frame -1 is out of range for "hero" (8 frames)');
    expect(() => assets.getFrame("hero", 1.5)).toThrow('Frame 1.5 is out of range for "hero" (8 frames)');
    expect(() => assets.getFrame("bg", 1)).toThrow('Frame 1 is out of range for "bg" (1 frame)');
  });
});
