import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserImageStore,
  ImageStore,
  toImageSources,
  type StoredImage,
} from "../../src/engine";
import { MemoryImageStorage } from "../helpers/memory-image-storage";

const file = new Blob(["x"], { type: "image/png" });
const sheet = { frameWidth: 16, frameHeight: 16, animations: { walk: { frames: [0, 1], fps: 8 } } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImageStore", () => {
  it("saves, lists, overwrites by name and removes", async () => {
    const store = new ImageStore(new MemoryImageStorage());
    expect(store.available).toBe(true);
    await store.save({ name: "slime", file });
    await store.save({ name: "coin", file });
    await store.save({ name: "slime", file, sheet });
    const listed = await store.list();
    expect(listed.map((image) => image.name).sort()).toEqual(["coin", "slime"]);
    expect(listed.find((image) => image.name === "slime")?.sheet).toEqual(sheet);
    await store.remove("coin");
    expect((await store.list()).map((image) => image.name)).toEqual(["slime"]);
  });

  it("passes on storage failures", async () => {
    const storage = new MemoryImageStorage();
    storage.failWith = "quota exceeded";
    const store = new ImageStore(storage);
    await expect(store.save({ name: "slime", file })).rejects.toThrow("quota exceeded");
  });

  it("without storage lists nothing and rejects writes", async () => {
    const store = new ImageStore(null);
    expect(store.available).toBe(false);
    expect(await store.list()).toEqual([]);
    await expect(store.save({ name: "slime", file })).rejects.toThrow(
      "Images can't be saved in this browser",
    );
    await expect(store.remove("slime")).rejects.toThrow("Images can't be saved in this browser");
  });

  it("browserImageStore is unavailable where there is no IndexedDB", async () => {
    // Vitest runs in Node, which has no indexedDB.
    const store = await browserImageStore();
    expect(store.available).toBe(false);
  });
});

describe("toImageSources", () => {
  const urls = (image: Blob) => (image === file ? "blob:1" : "blob:other");

  it("keeps the built-ins and adds single images and sheets with their URLs", () => {
    const stored: StoredImage[] = [
      { name: "coin", file },
      { name: "slime", file, sheet },
    ];
    expect(toImageSources(stored, { bg: "/bg.png" }, urls)).toEqual({
      bg: "/bg.png",
      coin: "blob:1",
      slime: { url: "blob:1", ...sheet },
    });
  });

  it("ignores an uploaded image that has a built-in's name, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sources = toImageSources([{ name: "bg", file }], { bg: "/bg.png" }, urls);
    expect(sources).toEqual({ bg: "/bg.png" });
    expect(warn).toHaveBeenCalledWith(
      'Uploaded image "bg" is ignored: an image declared in code has that name',
    );
  });
});
