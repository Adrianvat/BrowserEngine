import { validateStoredSheet, type StoredSheet } from "../engine";

/**
 * Where older versions of the editor kept scenes (localStorage) and images (IndexedDB).
 * Scenes and images are files in the project now; what is found here is offered for
 * import once (see views/migration.ts), then forgotten either way. Nothing is ever
 * written to browser storage any more.
 */
export const LEGACY_SCENE_PREFIX = "browser-engine:scene:";
export const LEGACY_DATABASE = "browser-engine";
const LEGACY_STORE = "images";

export type LegacyStorage = Pick<Storage, "getItem" | "removeItem">;

export interface LegacyScene {
  name: string;
  /** The saved JSON text, unchecked. */
  text: string;
}

export interface LegacyImage {
  name: string;
  file: Blob;
  sheet: StoredSheet | null;
}

/** What was found in this browser, and a way to forget it. */
export interface LegacyContent {
  scenes: LegacyScene[];
  images: LegacyImage[];
  forget(): Promise<void>;
}

/** The scenes among `names` that have a saved copy in `storage`. */
export function legacyScenes(storage: LegacyStorage, names: readonly string[]): LegacyScene[] {
  const scenes: LegacyScene[] = [];
  for (const name of names) {
    const text = storage.getItem(LEGACY_SCENE_PREFIX + name);
    if (text !== null) scenes.push({ name, text });
  }
  return scenes;
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The legacy database if it exists; null otherwise (it is never created here). */
async function openLegacyDatabase(factory: IDBFactory): Promise<IDBDatabase | null> {
  const open = factory.open(LEGACY_DATABASE);
  // Opening creates a database that does not exist; aborting the upgrade undoes that.
  open.onupgradeneeded = () => open.transaction?.abort();
  try {
    return await result(open);
  } catch {
    return null;
  }
}

function legacyImage(value: unknown): LegacyImage | null {
  if (typeof value !== "object" || value === null) return null;
  const { name, file, sheet } = value as Record<string, unknown>;
  if (typeof name !== "string" || !(file instanceof Blob)) return null;
  let checked: StoredSheet | null = null;
  if (sheet !== undefined) {
    try {
      checked = validateStoredSheet(sheet);
    } catch {
      checked = null; // The image is still worth keeping; the frame size can be set again.
    }
  }
  return { name, file, sheet: checked };
}

/** The images an older version kept in IndexedDB; none when there is no such database. */
export async function legacyImages(factory: IDBFactory | null): Promise<LegacyImage[]> {
  if (!factory) return [];
  const db = await openLegacyDatabase(factory);
  if (!db) return [];
  try {
    if (!db.objectStoreNames.contains(LEGACY_STORE)) return [];
    const records = await result(db.transaction(LEGACY_STORE).objectStore(LEGACY_STORE).getAll());
    return records.map(legacyImage).filter((image): image is LegacyImage => image !== null);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function deleteDatabase(factory: IDBFactory): Promise<void> {
  return new Promise((resolve) => {
    const request = factory.deleteDatabase(LEGACY_DATABASE);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

/** The browser's localStorage, or null when it is missing or blocked. */
export function browserLocalStorage(): LegacyStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Everything older versions of the editor left in this browser, for `sceneNames`, or
 * null when there is nothing. `forget` clears it all.
 */
export async function findLegacyContent(
  storage: LegacyStorage | null,
  factory: IDBFactory | null,
  sceneNames: readonly string[],
): Promise<LegacyContent | null> {
  const scenes = storage ? legacyScenes(storage, sceneNames) : [];
  const images = await legacyImages(factory);
  if (scenes.length === 0 && images.length === 0) return null;
  return {
    scenes,
    images,
    async forget() {
      for (const scene of scenes) storage?.removeItem(LEGACY_SCENE_PREFIX + scene.name);
      if (images.length > 0 && factory) await deleteDatabase(factory);
    },
  };
}
