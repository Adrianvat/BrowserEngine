import { describe, expect, it } from "vitest";
import {
  findLegacyContent,
  LEGACY_DATABASE,
  LEGACY_SCENE_PREFIX,
  legacyImages,
  legacyScenes,
} from "../../src/editor/legacy-storage";
import { MemoryStorage } from "../helpers/memory-storage";

/** A request that fires its handlers on the next tick, as IndexedDB would. */
function request<T>(settle: (req: FakeRequest<T>) => void): FakeRequest<T> {
  const req = new FakeRequest<T>();
  setTimeout(() => settle(req), 0);
  return req;
}

class FakeRequest<T> {
  result!: T;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
  transaction: { abort(): void } | null = null;
}

/**
 * Just enough of IndexedDB: a factory with zero or one database, which may hold the
 * legacy "images" store. Records what happened.
 */
class FakeIndexedDb {
  readonly log: string[] = [];
  closed = 0;

  constructor(
    private databases: Record<string, Record<string, unknown[]> | null> = {},
  ) {}

  open(name: string): IDBOpenDBRequest {
    this.log.push(`open ${name}`);
    return request<IDBDatabase>((req) => {
      const stores = this.databases[name];
      if (stores === undefined) {
        // A new database: the upgrade runs first; aborting it leaves nothing behind.
        let aborted = false;
        req.transaction = {
          abort: () => {
            aborted = true;
          },
        };
        req.onupgradeneeded?.();
        if (aborted) {
          req.error = new Error("AbortError");
          req.onerror?.();
          return;
        }
        this.databases[name] = {};
        this.log.push(`created ${name}`);
      }
      req.result = this.database(name);
      req.onsuccess?.();
    }) as unknown as IDBOpenDBRequest;
  }

  deleteDatabase(name: string): IDBOpenDBRequest {
    this.log.push(`delete ${name}`);
    delete this.databases[name];
    return request<undefined>((req) => req.onsuccess?.()) as unknown as IDBOpenDBRequest;
  }

  has(name: string): boolean {
    return this.databases[name] !== undefined;
  }

  private database(name: string): IDBDatabase {
    const stores = this.databases[name] ?? {};
    return {
      objectStoreNames: { contains: (store: string) => store in stores },
      transaction: (store: string) => ({
        objectStore: () => ({
          getAll: () => request<unknown[]>((req) => {
            req.result = stores[store];
            req.onsuccess?.();
          }),
        }),
      }),
      close: () => this.closed++,
    } as unknown as IDBDatabase;
  }
}

const factory = (db: FakeIndexedDb) => db as unknown as IDBFactory;
const png = new Blob(["x"], { type: "image/png" });

describe("legacyScenes", () => {
  it("finds the saved copies of the named scenes", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_SCENE_PREFIX + "play", "{}");
    storage.setItem(LEGACY_SCENE_PREFIX + "bonus", "{}");
    storage.setItem("other:key", "x");
    expect(legacyScenes(storage, ["title", "play"])).toEqual([{ name: "play", text: "{}" }]);
  });
});

describe("legacyImages", () => {
  it("reads the images from the old database, skipping records that make no sense", async () => {
    const db = new FakeIndexedDb({
      [LEGACY_DATABASE]: {
        images: [
          { name: "slime", file: png, sheet: { frameWidth: 8, frameHeight: 8, animations: {} } },
          { name: "coin", file: png },
          { name: "odd", file: png, sheet: { frameWidth: 0 } },
          { name: 5, file: png },
          "junk",
        ],
      },
    });
    expect(await legacyImages(factory(db))).toEqual([
      { name: "slime", file: png, sheet: { frameWidth: 8, frameHeight: 8, animations: {} } },
      { name: "coin", file: png, sheet: null },
      { name: "odd", file: png, sheet: null },
    ]);
    expect(db.closed).toBe(1);
  });

  it("never creates the database when there is none, and copes with an empty one", async () => {
    const none = new FakeIndexedDb();
    expect(await legacyImages(factory(none))).toEqual([]);
    expect(none.has(LEGACY_DATABASE)).toBe(false);
    expect(none.log).toEqual([`open ${LEGACY_DATABASE}`]);
    const empty = new FakeIndexedDb({ [LEGACY_DATABASE]: {} });
    expect(await legacyImages(factory(empty))).toEqual([]);
    expect(await legacyImages(null)).toEqual([]);
  });
});

describe("findLegacyContent", () => {
  it("is null when there is nothing, otherwise has it all and forgets it on request", async () => {
    const storage = new MemoryStorage();
    expect(await findLegacyContent(storage, factory(new FakeIndexedDb()), ["play"])).toBeNull();

    storage.setItem(LEGACY_SCENE_PREFIX + "play", "{}");
    const db = new FakeIndexedDb({ [LEGACY_DATABASE]: { images: [{ name: "coin", file: png }] } });
    const legacy = await findLegacyContent(storage, factory(db), ["play"]);
    expect(legacy?.scenes).toEqual([{ name: "play", text: "{}" }]);
    expect(legacy?.images).toEqual([{ name: "coin", file: png, sheet: null }]);
    await legacy!.forget();
    expect(storage.getItem(LEGACY_SCENE_PREFIX + "play")).toBeNull();
    expect(db.has(LEGACY_DATABASE)).toBe(false);
  });

  it("works with scenes only, without touching a database that is not there", async () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_SCENE_PREFIX + "play", "{}");
    const db = new FakeIndexedDb();
    const legacy = await findLegacyContent(storage, factory(db), ["play"]);
    expect(legacy?.images).toEqual([]);
    await legacy!.forget();
    expect(db.log).toEqual([`open ${LEGACY_DATABASE}`]);
    expect(await findLegacyContent(null, null, ["play"])).toBeNull();
  });
});
