import { afterEach, describe, it, expect, vi } from "vitest";
import type { SceneData } from "../../src/engine/data/scene-data";
import { browserSceneStore, SceneStore } from "../../src/engine/data/scene-store";
import { MemoryStorage } from "../helpers/memory-storage";

const data: SceneData = { version: 1, entities: [{ name: "A", components: {} }] };

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("SceneStore", () => {
  it("saves under browser-engine:scene:<name> and loads the JSON back", () => {
    const storage = new MemoryStorage();
    const store = new SceneStore(storage);
    expect(store.load("play")).toBeNull();
    store.save("play", data);
    expect(JSON.parse(storage.getItem("browser-engine:scene:play")!)).toEqual(data);
    expect(JSON.parse(store.load("play")!)).toEqual(data);
  });

  it("keeps scenes apart", () => {
    const store = new SceneStore(new MemoryStorage());
    store.save("play", data);
    expect(store.load("title")).toBeNull();
  });

  it("reset deletes the saved copy", () => {
    const store = new SceneStore(new MemoryStorage());
    store.save("play", data);
    store.reset("play");
    expect(store.load("play")).toBeNull();
  });

  it("without storage, loads nothing and refuses to save or reset", () => {
    const store = new SceneStore(null);
    expect(store.load("play")).toBeNull();
    expect(() => store.save("play", data)).toThrow("Browser storage is not available");
    expect(() => store.reset("play")).toThrow("Browser storage is not available");
  });

  it("lets storage errors through", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("Quota exceeded");
    };
    expect(() => new SceneStore(storage).save("play", data)).toThrow("Quota exceeded");
  });
});

describe("browserSceneStore", () => {
  it("uses localStorage when it is available", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    browserSceneStore().save("play", data);
    expect(storage.getItem("browser-engine:scene:play")).not.toBeNull();
  });

  it("has no storage when reading localStorage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Access denied");
      },
    });
    expect(() => browserSceneStore().save("play", data)).toThrow(
      "Browser storage is not available",
    );
  });

  it("has no storage when localStorage does not exist", () => {
    expect(() => browserSceneStore().save("play", data)).toThrow(
      "Browser storage is not available",
    );
  });
});
