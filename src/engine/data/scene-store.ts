import type { SceneData } from "./scene-data";

/** The part of localStorage the store uses. */
export type SceneStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function keyOf(scene: string): string {
  return `browser-engine:scene:${scene}`;
}

/** Scenes saved by the editor, kept in browser storage. */
export class SceneStore {
  constructor(private readonly storage: SceneStorage | null) {}

  /** The saved JSON text, or null when the scene has no saved copy. */
  load(scene: string): string | null {
    return this.storage?.getItem(keyOf(scene)) ?? null;
  }

  save(scene: string, data: SceneData): void {
    this.required().setItem(keyOf(scene), JSON.stringify(data));
  }

  /** Deletes the saved copy, so the scene's default data is used again. */
  reset(scene: string): void {
    this.required().removeItem(keyOf(scene));
  }

  private required(): SceneStorage {
    if (!this.storage) throw new Error("Browser storage is not available");
    return this.storage;
  }
}

/** A store backed by localStorage, or by nothing when the browser blocks it. */
export function browserSceneStore(): SceneStore {
  let storage: SceneStorage | null = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    storage = null;
  }
  return new SceneStore(storage);
}
