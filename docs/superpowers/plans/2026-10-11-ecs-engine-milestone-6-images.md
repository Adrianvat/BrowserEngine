# Milestone 6: Images in the Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload images in the editor, make them sprite sheets with animation clips, store them in IndexedDB, and use them in Sprite/Animator on both the editor and game pages.

**Architecture:**
- The engine gains three things:
  - `checkSheet`, which extracts `Assets`' sheet validation into a pure function;
  - `Assets.removeImage`;
  - `ImageStore`, an async store over an `ImageStorage` interface, backed by IndexedDB in the browser and by memory in tests. `toImageSources` turns stored records into the `ImageSource`s `Assets` already loads.
- The editor gains:
  - `ImageLibrary`, which owns uploaded and built-in images, validates each edit, serializes writes, saves and reloads into `Assets`;
  - pure helpers for names, frames text and image usages;
  - two DOM views.
- `EditorModel` reads image names from the library.

**Tech Stack:** TypeScript 7 (strict), Vite 8, Vitest 5 (Node, no DOM), Canvas 2D, IndexedDB. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-ecs-engine-milestone-6-images-design.md`

## Global Constraints

- TypeScript strict, `verbatimModuleSyntax` (use `import type` for types), `noUnusedLocals`, `noUnusedParameters`.
- No runtime dependencies.
- Game and editor code import engine code only from `src/engine/index.ts` (`"../engine"` / `"../../engine"`). Engine-internal files import each other directly.
- Tests run in Vitest under Node: no DOM, no IndexedDB. Browser-only pieces are injected.
- Existing `Assets` error messages stay exactly the same, and the existing `tests/engine/assets.test.ts` cases pass unchanged.
- IndexedDB database `browser-engine`, object store `images`, keyed by `name`.
- Message texts (exact):
  - `Images can't be saved in this browser`
  - `Couldn't read <file> as an image`
  - `Couldn't save image: <reason>`
  - `Frames must be numbers like 2, 3, 4`
  - `Set both frame width and height, or neither`
  - `Clip name can't be empty`
  - `Clip "<name>" already exists`
- Built-ins (`definition.images`) are read-only in the editor and win any name clash.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Pxt2G9uuDdkshuneCFv8k8
  ```
- Work on branch `milestone-6-images` (create it from `master` before Task 1: `git checkout -b milestone-6-images`).

## Review Focus

1. **Fast successive edits** (typing in fps, clicking ✕ on two clips quickly). Writes are async. Each must apply on top of the previous one, with no lost updates. Covered by `ImageLibrary` "writes run one at a time" tests in Tasks 5 and 6.
2. **Shrinking the frame size so existing clips go out of range.** This must be rejected with the `checkSheet` message, leaving the store and `Assets` unchanged, never storing a sheet the game can't load. Covered in Task 6.
3. **Clearing the frame size of a sheet that has clips.** Clips must never be silently dropped: this is rejected with `Remove the clips before making this a single image`. Covered in Task 6.
4. **A storage failure (quota, blocked) mid-edit.** The editor's state, the store and `Assets` must all stay at the last saved version, and the message is shown. Covered in Tasks 5 and 6.
5. **An uploaded image whose name later matches a built-in.** Both pages must use the built-in and ignore the upload, with a warning, not crash or override. Covered in Tasks 2 and 5.

---

## File map

**Engine:**
- Modify `src/engine/assets/assets.ts`: add `checkSheet`, `SheetLayout`, `CheckedSheet` and `Assets.removeImage`.
- Create `src/engine/data/image-store.ts`: `StoredImage`, `StoredSheet`, `ImageStorage`, `ImageStore`, `browserImageStore`, `imageSource`, `withoutBuiltInClashes`, `toImageSources`.
- Modify `src/engine/index.ts`: add the exports.

**Editor:**
- Create `src/editor/image-names.ts`: `imageNameFromFile` and `uniqueName`.
- Create `src/editor/frames-text.ts`: `parseFrames` and `formatFrames`.
- Create `src/editor/image-usages.ts`: `imageUsages` and `formatUsages`.
- Create `src/editor/image-library.ts`: `ImageLibrary`.
- Modify `src/editor/model.ts`: an `imageNames` source, `imagesChanged` and `allScenes`.
- Create `src/editor/views/image-list.ts` and `src/editor/views/image-details.ts`.
- Modify `src/editor/views/inspector.ts`: the shape includes the image names.
- Modify `src/editor/main.ts` and `editor.html`.

**Game:**
- Modify `src/game/main.ts`.

**Tests:**
- Create `tests/helpers/memory-image-storage.ts`.
- Create `tests/engine/image-store.test.ts`.
- Modify `tests/engine/assets.test.ts`.
- Create `tests/editor/{image-names, frames-text, image-usages, image-library}.test.ts`.
- Modify `tests/editor/model.test.ts`.

---

### Task 1: `checkSheet` and `Assets.removeImage`

**Files:**
- Modify: `src/engine/assets/assets.ts`
- Modify: `src/engine/index.ts`
- Test: `tests/engine/assets.test.ts`

**Interfaces:**
- Produces:
  - `export type SheetLayout = Omit<SheetSource, "url">`
  - `export interface CheckedSheet { columns: number; count: number; animations: Map<string, Required<AnimationClip>> }`
  - `export function checkSheet(name: string, width: number, height: number, sheet: SheetLayout): CheckedSheet`
  - `Assets.removeImage(name: string): void`
  - All of these are exported from `src/engine/index.ts` (`checkSheet`, with `type SheetLayout` and `type CheckedSheet`).

- [ ] **Step 1: Write the failing tests.** Append to `tests/engine/assets.test.ts`, and change its import line to `import { Assets, checkSheet, type AnimationClip, type ImageLoader } from "../../src/engine/assets/assets";`:

```ts
describe("checkSheet", () => {
  it("returns the grid and the clips with loop filled in", () => {
    const checked = checkSheet("hero", 64, 32, {
      frameWidth: 16,
      frameHeight: 16,
      animations: { walk: { frames: [1, 7], fps: 8 } },
    });
    expect(checked.columns).toBe(4);
    expect(checked.count).toBe(8);
    expect(checked.animations.get("walk")).toEqual({ frames: [1, 7], fps: 8, loop: true });
  });

  it("accepts a sheet without clips", () => {
    expect(checkSheet("s", 40, 20, { frameWidth: 16, frameHeight: 16 }).count).toBe(2);
  });

  it("throws the same messages as loadImages", () => {
    expect(() => checkSheet("s", 64, 64, { frameWidth: 0, frameHeight: 16 })).toThrow(
      'Invalid frame size for image "s"',
    );
    expect(() => checkSheet("s", 8, 8, { frameWidth: 16, frameHeight: 16 })).toThrow(
      'Image "s" (8x8) is smaller than one 16x16 frame',
    );
    expect(() =>
      checkSheet("s", 32, 16, {
        frameWidth: 16,
        frameHeight: 16,
        animations: { a: { frames: [2], fps: 1 } },
      }),
    ).toThrow('Animation "a" of image "s": frame 2 is out of range (2 frames)');
  });
});

describe("Assets.removeImage", () => {
  it("forgets a loaded image and ignores unknown names", async () => {
    const assets = new Assets(fakeLoader({ "/bg.png": fakeImage(8, 8) }));
    await assets.loadImages({ bg: "/bg.png" });
    assets.removeImage("bg");
    assets.removeImage("nope");
    expect(assets.hasImage("bg")).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `npx vitest run tests/engine/assets.test.ts`
Expected: FAIL. `checkSheet` is not exported (`checkSheet is not a function`) and `assets.removeImage is not a function`.

- [ ] **Step 3: Implement.** In `src/engine/assets/assets.ts`, after `checkAnimations`, add:

```ts
/** A sprite sheet's layout: a SheetSource without its file. */
export type SheetLayout = Omit<SheetSource, "url">;

/** A sheet's grid and clips, checked against the image's size. */
export interface CheckedSheet {
  columns: number;
  count: number;
  animations: Map<string, Required<AnimationClip>>;
}

/**
 * Checks a sheet layout against the image's size in pixels, with the messages
 * loadImages uses. The editor calls it before saving a sheet.
 */
export function checkSheet(
  name: string,
  width: number,
  height: number,
  sheet: SheetLayout,
): CheckedSheet {
  const { frameWidth, frameHeight } = sheet;
  if (!(isPositiveInteger(frameWidth) && isPositiveInteger(frameHeight))) {
    throw new Error(`Invalid frame size for image "${name}"`);
  }
  const columns = Math.floor(width / frameWidth);
  const rows = Math.floor(height / frameHeight);
  if (columns === 0 || rows === 0) {
    throw new Error(
      `Image "${name}" (${width}x${height}) is smaller than one ${frameWidth}x${frameHeight} frame`,
    );
  }
  const count = columns * rows;
  return { columns, count, animations: checkAnimations(name, count, sheet.animations ?? {}) };
}
```

In `Assets`, after `hasAnimation`, add:

```ts
  /** Forgets an image; unknown names are ignored. */
  removeImage(name: string): void {
    this.images.delete(name);
  }
```

In `loadOne`, replace everything from `const { frameWidth, frameHeight } = source;` to the end of the method with:

```ts
    const { columns, count, animations } = checkSheet(name, width, height, source);
    const { frameWidth, frameHeight } = source;
    return { image, frameWidth, frameHeight, columns, count, animations };
```

The frame-size check before loading stays where it is, so a bad frame size still fails before the download.

In `src/engine/index.ts`, replace the two assets lines with:

```ts
export { Assets, checkSheet } from "./assets/assets";
export type {
  AnimationClip,
  CheckedSheet,
  Frame,
  ImageLoader,
  ImageSource,
  SheetLayout,
  SheetSource,
} from "./assets/assets";
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run tests/engine/assets.test.ts`
Expected: PASS, every existing case plus the 4 new ones.

- [ ] **Step 5: Commit.**

```bash
git add src/engine/assets/assets.ts src/engine/index.ts tests/engine/assets.test.ts
git commit -m "feat: checkSheet validates a sheet layout; Assets.removeImage"
```

(Every commit in this plan ends with the trailer from Global Constraints.)

---

### Task 2: `ImageStore` and `toImageSources`

**Files:**
- Create: `src/engine/data/image-store.ts`
- Create: `tests/helpers/memory-image-storage.ts`
- Modify: `src/engine/index.ts`
- Test: `tests/engine/image-store.test.ts`

**Interfaces:**
- Consumes: `AnimationClip`, `ImageSource` (Task 1 / existing).
- Produces:
  - `interface StoredSheet { frameWidth: number; frameHeight: number; animations: Record<string, AnimationClip> }`
  - `interface StoredImage { name: string; file: Blob; sheet?: StoredSheet }`
  - `interface ImageStorage { list(): Promise<StoredImage[]>; save(image: StoredImage): Promise<void>; remove(name: string): Promise<void> }`
  - `class ImageStore`:
    - `constructor(storage: ImageStorage | null)`;
    - `readonly available: boolean`;
    - `list(): Promise<StoredImage[]>`;
    - `save(image: StoredImage): Promise<void>`;
    - `remove(name: string): Promise<void>`.
  - `browserImageStore(): Promise<ImageStore>`
  - `imageSource(image: StoredImage, url: string): ImageSource`
  - `withoutBuiltInClashes(stored: StoredImage[], builtIns: Record<string, ImageSource>): StoredImage[]`. It warns once per skipped image.
  - `toImageSources(stored: StoredImage[], builtIns: Record<string, ImageSource>, createUrl: (file: Blob) => string): Record<string, ImageSource>`
  - Test helper `MemoryImageStorage` (in `tests/helpers/memory-image-storage.ts`):
    - `images: Map<string, StoredImage>`;
    - `failWith: string | null`: when set, `save` and `remove` reject with `new Error(failWith)`.
  - Everything above is exported from `src/engine/index.ts`.

- [ ] **Step 1: Write the test helper.** Create `tests/helpers/memory-image-storage.ts`:

```ts
import type { ImageStorage, StoredImage } from "../../src/engine";

/** Copies a record the way IndexedDB would, so callers can't change what is stored. */
function copy(image: StoredImage): StoredImage {
  return image.sheet
    ? { name: image.name, file: image.file, sheet: structuredClone(image.sheet) }
    : { name: image.name, file: image.file };
}

/** Stands in for IndexedDB. */
export class MemoryImageStorage implements ImageStorage {
  readonly images = new Map<string, StoredImage>();
  /** When set, save and remove reject with this message (e.g. a full quota). */
  failWith: string | null = null;

  async list(): Promise<StoredImage[]> {
    return [...this.images.values()].map(copy);
  }

  async save(image: StoredImage): Promise<void> {
    this.check();
    this.images.set(image.name, copy(image));
  }

  async remove(name: string): Promise<void> {
    this.check();
    this.images.delete(name);
  }

  private check(): void {
    if (this.failWith !== null) throw new Error(this.failWith);
  }
}
```

- [ ] **Step 2: Write the failing tests.** Create `tests/engine/image-store.test.ts`:

```ts
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
```

- [ ] **Step 3: Run them to verify they fail.**

Run: `npx vitest run tests/engine/image-store.test.ts`
Expected: FAIL, because `ImageStore`, `browserImageStore` and `toImageSources` are not exported from `src/engine`.

- [ ] **Step 4: Implement.** Create `src/engine/data/image-store.ts`:

```ts
import type { AnimationClip, ImageSource } from "../assets/assets";

/** A stored image's sprite sheet layout. */
export interface StoredSheet {
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, AnimationClip>;
}

/** An image uploaded in the editor. */
export interface StoredImage {
  name: string;
  /** The uploaded file, unchanged. */
  file: Blob;
  /** Absent for a single image (one frame). */
  sheet?: StoredSheet;
}

/** Where uploaded images are kept: IndexedDB in the browser. */
export interface ImageStorage {
  list(): Promise<StoredImage[]>;
  /** Adds the image, or replaces the one with the same name. */
  save(image: StoredImage): Promise<void>;
  remove(name: string): Promise<void>;
}

const UNAVAILABLE = "Images can't be saved in this browser";

/** Images uploaded in the editor, kept in browser storage. */
export class ImageStore {
  constructor(private readonly storage: ImageStorage | null) {}

  /** False when the browser has no usable storage; built-ins still work. */
  get available(): boolean {
    return this.storage !== null;
  }

  async list(): Promise<StoredImage[]> {
    return this.storage ? this.storage.list() : [];
  }

  async save(image: StoredImage): Promise<void> {
    await this.required().save(image);
  }

  async remove(name: string): Promise<void> {
    await this.required().remove(name);
  }

  private required(): ImageStorage {
    if (!this.storage) throw new Error(UNAVAILABLE);
    return this.storage;
  }
}

const DATABASE = "browser-engine";
const OBJECT_STORE = "images";

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves when a write transaction is committed; a full quota rejects here. */
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Transaction aborted"));
  });
}

class IndexedDbStorage implements ImageStorage {
  constructor(private readonly db: IDBDatabase) {}

  list(): Promise<StoredImage[]> {
    const store = this.db.transaction(OBJECT_STORE).objectStore(OBJECT_STORE);
    return result(store.getAll() as IDBRequest<StoredImage[]>);
  }

  save(image: StoredImage): Promise<void> {
    const transaction = this.db.transaction(OBJECT_STORE, "readwrite");
    transaction.objectStore(OBJECT_STORE).put(image);
    return committed(transaction);
  }

  remove(name: string): Promise<void> {
    const transaction = this.db.transaction(OBJECT_STORE, "readwrite");
    transaction.objectStore(OBJECT_STORE).delete(name);
    return committed(transaction);
  }
}

/** A store backed by IndexedDB, or by nothing when the browser has none or blocks it. */
export async function browserImageStore(): Promise<ImageStore> {
  try {
    if (!globalThis.indexedDB) return new ImageStore(null);
    const open = globalThis.indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(OBJECT_STORE, { keyPath: "name" });
    };
    return new ImageStore(new IndexedDbStorage(await result(open)));
  } catch {
    return new ImageStore(null);
  }
}

/** What Assets loads for a stored image, given a URL for its file. */
export function imageSource(image: StoredImage, url: string): ImageSource {
  return image.sheet ? { url, ...image.sheet } : url;
}

/** Drops (with a warning) uploaded images that have a built-in's name: the built-in wins. */
export function withoutBuiltInClashes(
  stored: StoredImage[],
  builtIns: Record<string, ImageSource>,
): StoredImage[] {
  return stored.filter((image) => {
    if (!Object.hasOwn(builtIns, image.name)) return true;
    console.warn(`Uploaded image "${image.name}" is ignored: an image declared in code has that name`);
    return false;
  });
}

/** The built-ins plus the uploaded images, ready for Assets.loadImages. */
export function toImageSources(
  stored: StoredImage[],
  builtIns: Record<string, ImageSource>,
  createUrl: (file: Blob) => string,
): Record<string, ImageSource> {
  const sources: Record<string, ImageSource> = { ...builtIns };
  for (const image of withoutBuiltInClashes(stored, builtIns)) {
    sources[image.name] = imageSource(image, createUrl(image.file));
  }
  return sources;
}
```

In `src/engine/index.ts`, after the `scene-store` exports, add:

```ts
export {
  browserImageStore,
  ImageStore,
  imageSource,
  toImageSources,
  withoutBuiltInClashes,
} from "./data/image-store";
export type { ImageStorage, StoredImage, StoredSheet } from "./data/image-store";
```

- [ ] **Step 5: Run the tests to verify they pass, then typecheck.**

Run: `npx vitest run tests/engine/image-store.test.ts`
Expected: PASS (6 tests).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add src/engine/data/image-store.ts src/engine/index.ts tests/helpers/memory-image-storage.ts tests/engine/image-store.test.ts
git commit -m "feat: ImageStore keeps uploaded images in IndexedDB; toImageSources feeds them to Assets"
```

---

### Task 3: Editor helpers for names, frames text and image usages

**Files:**
- Create: `src/editor/image-names.ts`, `src/editor/frames-text.ts`, `src/editor/image-usages.ts`
- Test: `tests/editor/image-names.test.ts`, `tests/editor/frames-text.test.ts`, `tests/editor/image-usages.test.ts`

**Interfaces:**
- Produces:
  - `uniqueName(base: string, taken: Iterable<string>): string`. Returns `base`, else `base-2`, `base-3`… (the first one not taken).
  - `imageNameFromFile(fileName: string, taken: Iterable<string>): string`
  - `parseFrames(text: string): number[] | null`. Integers separated by commas and/or spaces. Empty text gives `[]`. Returns `null` if any part is not an integer.
  - `formatFrames(frames: readonly number[]): string`. Returns `"2, 3, 4"`.
  - `interface ImageUsage { scene: string; entity: string }`
  - `imageUsages(image: string, scenes: Record<string, SceneData>, registry: ComponentRegistry): ImageUsage[]`. Checks every field of kind `"image"` in every registered component, in scene order and then entity order.
  - `formatUsages(usages: ImageUsage[]): string`. Returns `"Hero (play), Logo (title)"`; an unnamed entity shows as `(unnamed)`.

- [ ] **Step 1: Write the failing tests.**

`tests/editor/image-names.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { imageNameFromFile, uniqueName } from "../../src/editor/image-names";

describe("uniqueName", () => {
  it("adds -2, -3… until the name is free", () => {
    expect(uniqueName("clip", [])).toBe("clip");
    expect(uniqueName("clip", ["clip"])).toBe("clip-2");
    expect(uniqueName("clip", ["clip", "clip-2"])).toBe("clip-3");
  });
});

describe("imageNameFromFile", () => {
  it("uses the file name without its extension, lowercase, with dashes", () => {
    expect(imageNameFromFile("Slime Sheet.png", [])).toBe("slime-sheet");
    expect(imageNameFromFile("hero.v2.png", [])).toBe("hero-v2");
    expect(imageNameFromFile("  --Coin__Gold!!.gif", [])).toBe("coin-gold");
    expect(imageNameFromFile("noext", [])).toBe("noext");
  });

  it("falls back to image when nothing usable is left", () => {
    expect(imageNameFromFile("!!!.png", [])).toBe("image");
    expect(imageNameFromFile(".png", [])).toBe("image");
  });

  it("never returns a taken name, built-in or uploaded", () => {
    expect(imageNameFromFile("hero.png", ["hero"])).toBe("hero-2");
    expect(imageNameFromFile("hero.png", ["hero", "hero-2"])).toBe("hero-3");
  });
});
```

`tests/editor/frames-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatFrames, parseFrames } from "../../src/editor/frames-text";

describe("parseFrames", () => {
  it("reads integers separated by commas and/or spaces", () => {
    expect(parseFrames("2, 3, 4, 5")).toEqual([2, 3, 4, 5]);
    expect(parseFrames("2 3,4 ,, 5 ")).toEqual([2, 3, 4, 5]);
    expect(parseFrames("7")).toEqual([7]);
  });

  it("keeps negatives so the range check can name them", () => {
    expect(parseFrames("-1, 2")).toEqual([-1, 2]);
  });

  it("gives an empty list for empty text", () => {
    expect(parseFrames("  ")).toEqual([]);
  });

  it("gives null when a part is not a whole number", () => {
    expect(parseFrames("1, two")).toBeNull();
    expect(parseFrames("1.5")).toBeNull();
    expect(parseFrames("1e2")).toBeNull();
  });
});

describe("formatFrames", () => {
  it("joins with comma and space", () => {
    expect(formatFrames([2, 3, 4])).toBe("2, 3, 4");
    expect(formatFrames([])).toBe("");
  });
});
```

`tests/editor/image-usages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatUsages, imageUsages } from "../../src/editor/image-usages";
import { component, ComponentRegistry, type SceneData } from "../../src/engine";

class Badge {
  icon = "";
}

const registry = new ComponentRegistry([component(Badge, "Badge", { icon: "image" })]);

const scenes: Record<string, SceneData> = {
  play: {
    version: 1,
    entities: [
      { name: "Hero", components: { Sprite: { image: "slime" } } },
      { name: "Box", components: { Rect: {} } },
      { name: "Other", components: { Sprite: { image: "background" } } },
    ],
  },
  title: {
    version: 1,
    entities: [
      { name: "Logo", components: { Sprite: { image: "slime" } } },
      { name: "", components: { Badge: { icon: "slime" } } },
    ],
  },
};

describe("imageUsages", () => {
  it("finds every entity with an image field set to the image, in any scene", () => {
    expect(imageUsages("slime", scenes, registry)).toEqual([
      { scene: "play", entity: "Hero" },
      { scene: "title", entity: "Logo" },
      { scene: "title", entity: "" },
    ]);
  });

  it("is empty for an unused image", () => {
    expect(imageUsages("coin", scenes, registry)).toEqual([]);
  });

  it("ignores components the registry doesn't know", () => {
    const unknown: Record<string, SceneData> = {
      s: { version: 1, entities: [{ name: "X", components: { Mystery: { image: "slime" } } }] },
    };
    expect(imageUsages("slime", unknown, registry)).toEqual([]);
  });
});

describe("formatUsages", () => {
  it("lists entity (scene) pairs", () => {
    expect(
      formatUsages([
        { scene: "play", entity: "Hero" },
        { scene: "title", entity: "" },
      ]),
    ).toBe("Hero (play), (unnamed) (title)");
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `npx vitest run tests/editor/image-names.test.ts tests/editor/frames-text.test.ts tests/editor/image-usages.test.ts`
Expected: FAIL. The three modules can't be resolved.

- [ ] **Step 3: Implement.**

`src/editor/image-names.ts`:

```ts
/** `base` if it is free, otherwise the first free `base-2`, `base-3`… */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** A name for an uploaded file: "Slime Sheet.png" becomes "slime-sheet". */
export function imageNameFromFile(fileName: string, taken: Iterable<string>): string {
  const base =
    fileName
      .replace(/\.[^.]*$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "image";
  return uniqueName(base, taken);
}
```

`src/editor/frames-text.ts`:

```ts
/** "2, 3, 4" (commas and/or spaces) as numbers; null if a part isn't a whole number. */
export function parseFrames(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter((part) => part !== "");
  if (!parts.every((part) => /^-?\d+$/.test(part))) return null;
  return parts.map(Number);
}

export function formatFrames(frames: readonly number[]): string {
  return frames.join(", ");
}
```

`src/editor/image-usages.ts`:

```ts
import type { ComponentRegistry, SceneData } from "../engine";

/** An entity that shows an image. */
export interface ImageUsage {
  scene: string;
  entity: string;
}

/** Every entity, in every scene, with an image field (e.g. Sprite.image) set to `image`. */
export function imageUsages(
  image: string,
  scenes: Record<string, SceneData>,
  registry: ComponentRegistry,
): ImageUsage[] {
  const usages: ImageUsage[] = [];
  for (const [scene, data] of Object.entries(scenes)) {
    for (const entity of data.entities) {
      const uses = Object.entries(entity.components).some(([name, fields]) => {
        const definition = registry.get(name);
        if (!definition) return false;
        return Object.entries(definition.fields).some(
          ([field, kind]) => kind === "image" && fields[field] === image,
        );
      });
      if (uses) usages.push({ scene, entity: entity.name });
    }
  }
  return usages;
}

/** "Hero (play), Logo (title)" */
export function formatUsages(usages: ImageUsage[]): string {
  return usages.map(({ scene, entity }) => `${entity || "(unnamed)"} (${scene})`).join(", ");
}
```

- [ ] **Step 4: Run them to verify they pass.**

Run: `npx vitest run tests/editor/image-names.test.ts tests/editor/frames-text.test.ts tests/editor/image-usages.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/editor/image-names.ts src/editor/frames-text.ts src/editor/image-usages.ts tests/editor/image-names.test.ts tests/editor/frames-text.test.ts tests/editor/image-usages.test.ts
git commit -m "feat: editor helpers for image names, frames text and image usages"
```

---

### Task 4: `EditorModel` reads image names from a source and lists every scene's data

**Files:**
- Modify: `src/editor/model.ts`
- Test: `tests/editor/model.test.ts`

**Interfaces:**
- Produces:
  - `new EditorModel(definition, store, imageNames?: () => string[])`. The default is `() => Object.keys(definition.images)`.
  - `EditorModel.imageNames` returns `imageNames()` on every read.
  - `EditorModel.imagesChanged(): void` notifies listeners.
  - `EditorModel.allScenes(): Record<string, SceneData>` gives:
    - the current scene's in-memory data;
    - each other scene's saved copy, or its default if it has no saved copy.

    A scene whose data can't be read is left out, including the current one when it has a `loadError`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/editor/model.test.ts`:

```ts
describe("image names from the library", () => {
  it("reads the names from the function it is given, each time", () => {
    let images = ["slime"];
    const model = new EditorModel(definition, new SceneStore(new MemoryStorage()), () => images);
    expect(model.imageNames).toEqual(["slime"]);
    images = ["slime", "coin"];
    expect(model.imageNames).toEqual(["slime", "coin"]);
  });

  it("gives a new Sprite the first name from that function", () => {
    const model = new EditorModel(definition, new SceneStore(new MemoryStorage()), () => ["slime"]);
    model.addEntity();
    model.addComponent(2, "Sprite");
    expect(model.data.entities[2].components.Sprite.image).toBe("slime");
  });

  it("imagesChanged notifies listeners without saving", () => {
    const { model, changes, stored } = setup();
    model.imagesChanged();
    expect(changes()).toBe(1);
    expect(stored()).toBeNull();
  });
});

describe("allScenes", () => {
  it("has the open scene's edits and the other scenes' saved or default data", () => {
    const saved = JSON.stringify({ version: 1, entities: [{ name: "Saved", components: {} }] });
    const { model } = setup({ other: saved });
    model.rename(0, "Edited");
    const scenes = model.allScenes();
    expect(Object.keys(scenes)).toEqual(["main", "other"]);
    expect(scenes.main.entities.map((entity) => entity.name)).toEqual(["Edited", "Box"]);
    expect(scenes.other.entities.map((entity) => entity.name)).toEqual(["Saved"]);
  });

  it("uses default data for scenes with no saved copy", () => {
    const { model } = setup();
    expect(model.allScenes().other).toEqual({ version: 1, entities: [] });
  });

  it("leaves out scenes whose saved copy can't be read", () => {
    expect(Object.keys(setup({ other: "not json" }).model.allScenes())).toEqual(["main"]);
    expect(Object.keys(setup({ main: "not json" }).model.allScenes())).toEqual(["other"]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `npx vitest run tests/editor/model.test.ts`
Expected: FAIL. The image names still come from `definition.images` (`["hero", "bg"]`), and `imagesChanged` and `allScenes` are not functions.

- [ ] **Step 3: Implement.** In `src/editor/model.ts`, change the constructor to:

```ts
  constructor(
    readonly definition: GameDefinition,
    private readonly store: SceneStore,
    /** The images sprites can use; by default the ones the definition declares. */
    private readonly listImages: () => string[] = () => Object.keys(definition.images),
  ) {
```

Replace the `imageNames` getter with:

```ts
  get imageNames(): string[] {
    return this.listImages();
  }
```

After `onChange`, add:

```ts
  /** Call when images were added, changed or removed, so views redraw. */
  imagesChanged(): void {
    this.notify();
  }

  /** Every scene's current data, for finding where an image is used. Unreadable scenes are left out. */
  allScenes(): Record<string, SceneData> {
    const scenes: Record<string, SceneData> = {};
    for (const [name, entry] of Object.entries(this.definition.scenes)) {
      if (name === this.sceneName) {
        if (this.error === null) scenes[name] = this.sceneData;
        continue;
      }
      try {
        const saved = this.store.load(name);
        scenes[name] =
          saved === null
            ? validateSceneData(entry.data, this.registry)
            : parseSceneData(saved, this.registry);
      } catch {
        // A broken scene is reported when it is opened; here it just has no usages.
      }
    }
    return scenes;
  }
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run tests/editor/model.test.ts`
Expected: PASS, the existing cases plus the 6 new ones.

- [ ] **Step 5: Commit.**

```bash
git add src/editor/model.ts tests/editor/model.test.ts
git commit -m "feat: EditorModel takes its image names from a source and lists every scene's data"
```

---

### Task 5: `ImageLibrary`: load, add, remove, with writes in order

**Files:**
- Create: `src/editor/image-library.ts`
- Test: `tests/editor/image-library.test.ts`

**Interfaces:**
- Consumes:
  - from Task 1: `Assets.removeImage`;
  - from Task 2: `ImageStore`, `StoredImage`, `StoredSheet`, `imageSource` and `withoutBuiltInClashes`;
  - from Task 3: `imageNameFromFile`.
- Produces:
  - `interface ImageLibraryOptions { builtIns: Record<string, ImageSource>; store: ImageStore; assets: Assets; createUrl: (file: Blob) => string }`
  - `interface ImageInfo { name: string; builtIn: boolean; sheet: StoredSheet | null; width: number | null; height: number | null; frameCount: number | null; error: string | null }`
  - `class ImageLibrary`:
    - `constructor(options)`;
    - `available: boolean`;
    - `names: string[]` (built-ins in definition order, then uploaded names sorted);
    - `isBuiltIn(name)`;
    - `has(name)`;
    - `image(name): ImageInfo`;
    - `onChange(listener)`;
    - `load(): Promise<void>`;
    - `add(file: Blob, fileName: string): Promise<string>`, which resolves to the new name;
    - `remove(name): Promise<void>`.
  - Task 6 adds the sheet and clip edits to this class.

**Ruling recorded in the plan:** the spec lists an injected `decode` dependency. The library instead decodes by loading the file into its `Assets`. The `Assets` loader already decodes, reports failures and gives the size, so a separate decoder would duplicate it. Tests inject the `Assets` loader in place of `decode`.

- [ ] **Step 1: Write the failing tests.** Create `tests/editor/image-library.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `npx vitest run tests/editor/image-library.test.ts`
Expected: FAIL. `../../src/editor/image-library` can't be resolved.

- [ ] **Step 3: Implement.** Create `src/editor/image-library.ts`:

```ts
import {
  imageSource,
  withoutBuiltInClashes,
  type Assets,
  type ImageSource,
  type ImageStore,
  type StoredImage,
  type StoredSheet,
} from "../engine";
import { imageNameFromFile } from "./image-names";

export interface ImageLibraryOptions {
  /** The images declared in code; read-only here. */
  builtIns: Record<string, ImageSource>;
  store: ImageStore;
  /** The editor's Assets; every image is kept loaded in it. */
  assets: Assets;
  /** A URL the Assets loader can read for a file (URL.createObjectURL in the browser). */
  createUrl: (file: Blob) => string;
}

/** What the editor shows for one image. */
export interface ImageInfo {
  name: string;
  builtIn: boolean;
  /** null for a single image. */
  sheet: StoredSheet | null;
  /** Size in pixels; null when the image failed to load. */
  width: number | null;
  height: number | null;
  frameCount: number | null;
  error: string | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The built-in and uploaded images. Every write is checked, saved, then loaded into
 * Assets; a write that fails changes nothing. Writes run one at a time.
 */
export class ImageLibrary {
  private readonly uploaded = new Map<string, StoredImage>();
  private readonly urls = new Map<string, string>();
  private readonly errors = new Map<string, string>();
  private readonly listeners: (() => void)[] = [];
  /** The last write; the next one starts after it settles. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ImageLibraryOptions) {}

  /** False when the browser can't store images; uploading is then disabled. */
  get available(): boolean {
    return this.options.store.available;
  }

  /** Built-ins in definition order, then uploaded images sorted by name. */
  get names(): string[] {
    return [...Object.keys(this.options.builtIns), ...[...this.uploaded.keys()].sort()];
  }

  isBuiltIn(name: string): boolean {
    return Object.hasOwn(this.options.builtIns, name);
  }

  has(name: string): boolean {
    return this.isBuiltIn(name) || this.uploaded.has(name);
  }

  image(name: string): ImageInfo {
    const { assets } = this.options;
    const loaded = assets.hasImage(name);
    const element = loaded ? assets.getImage(name) : null;
    return {
      name,
      builtIn: this.isBuiltIn(name),
      sheet: this.sheetOf(name),
      width: element?.width ?? null,
      height: element?.height ?? null,
      frameCount: loaded ? assets.frameCount(name) : null,
      error: this.errors.get(name) ?? null,
    };
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** Loads the built-ins (a failure rejects) and the stored images (a failure is kept on the image). */
  async load(): Promise<void> {
    const { assets, builtIns, store } = this.options;
    await assets.loadImages(builtIns);
    for (const image of withoutBuiltInClashes(await store.list(), builtIns)) {
      this.uploaded.set(image.name, image);
      try {
        await this.loadIntoAssets(image);
      } catch (error) {
        this.errors.set(image.name, messageOf(error));
      }
    }
    this.notify();
  }

  /** Stores a file as a new single image named after it. Resolves to the name. */
  add(file: Blob, fileName: string): Promise<string> {
    return this.write(async () => {
      if (!this.available) throw new Error("Images can't be saved in this browser");
      const name = imageNameFromFile(fileName, this.names);
      const image: StoredImage = { name, file };
      try {
        await this.loadIntoAssets(image);
      } catch {
        this.forget(name);
        throw new Error(`Couldn't read ${fileName} as an image`);
      }
      try {
        await this.options.store.save(image);
      } catch (error) {
        this.forget(name);
        throw new Error(`Couldn't save image: ${messageOf(error)}`);
      }
      this.uploaded.set(name, image);
      return name;
    });
  }

  remove(name: string): Promise<void> {
    return this.write(async () => {
      this.checkUploaded(name);
      try {
        await this.options.store.remove(name);
      } catch (error) {
        throw new Error(`Couldn't delete image: ${messageOf(error)}`);
      }
      this.uploaded.delete(name);
      this.errors.delete(name);
      this.forget(name);
    });
  }

  private sheetOf(name: string): StoredSheet | null {
    if (this.isBuiltIn(name)) {
      const source = this.options.builtIns[name];
      if (typeof source === "string") return null;
      return {
        frameWidth: source.frameWidth,
        frameHeight: source.frameHeight,
        animations: source.animations ?? {},
      };
    }
    const image = this.uploaded.get(name);
    if (!image) throw new Error(`Image "${name}" not found`);
    return image.sheet ?? null;
  }

  /** Throws unless `name` is an uploaded image. */
  private checkUploaded(name: string): StoredImage {
    if (this.isBuiltIn(name)) {
      throw new Error(`Image "${name}" is defined in code and can't be changed here`);
    }
    const image = this.uploaded.get(name);
    if (!image) throw new Error(`Image "${name}" not found`);
    return image;
  }

  private async loadIntoAssets(image: StoredImage): Promise<void> {
    let url = this.urls.get(image.name);
    if (url === undefined) {
      url = this.options.createUrl(image.file);
      this.urls.set(image.name, url);
    }
    await this.options.assets.loadImages({ [image.name]: imageSource(image, url) });
  }

  private forget(name: string): void {
    this.options.assets.removeImage(name);
    this.urls.delete(name);
  }

  /** Runs `action` after every earlier write; listeners hear about it if it succeeds. */
  private write<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result.then((value) => {
      this.notify();
      return value;
    });
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass, then typecheck.**

Run: `npx vitest run tests/editor/image-library.test.ts`
Expected: PASS (16 tests).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add src/editor/image-library.ts tests/editor/image-library.test.ts
git commit -m "feat: ImageLibrary loads, adds and removes uploaded images, one write at a time"
```

---

### Task 6: `ImageLibrary` sheet and clip edits

**Files:**
- Modify: `src/editor/image-library.ts`
- Test: `tests/editor/image-library.test.ts`

**Interfaces:**
- Consumes:
  - from Task 1: `checkSheet`;
  - from Task 3: `uniqueName`;
  - from Task 5: `ImageLibrary`'s private `write`, `checkUploaded` and `loadIntoAssets`.
- Produces:
  - `interface ClipChanges { name?: string; frames?: number[]; fps?: number; loop?: boolean }`
  - `ImageLibrary.setFrameSize(name: string, width: number | null, height: number | null): Promise<void>`
  - `ImageLibrary.addClip(name: string): Promise<string>`, which resolves to the new clip's name
  - `ImageLibrary.updateClip(name: string, clip: string, changes: ClipChanges): Promise<void>`
  - `ImageLibrary.removeClip(name: string, clip: string): Promise<void>`

  Each of these:
  - rejects with a message and changes nothing (memory, store, Assets) when the edit is invalid or the save fails;
  - rejects for a built-in with the "defined in code" message;
  - rejects for an image that failed to load with `Image "<name>" could not be loaded; delete it and upload it again`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/editor/image-library.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `npx vitest run tests/editor/image-library.test.ts`
Expected: FAIL in the new describe blocks, with `ctx.library.setFrameSize is not a function` (and likewise for the other new methods). The Task 5 tests still pass.

- [ ] **Step 3: Implement.** In `src/editor/image-library.ts`:

Change the engine import to also bring in `checkSheet` and `type AnimationClip`, and import `uniqueName`:

```ts
import {
  checkSheet,
  imageSource,
  withoutBuiltInClashes,
  type AnimationClip,
  type Assets,
  type ImageSource,
  type ImageStore,
  type StoredImage,
  type StoredSheet,
} from "../engine";
import { imageNameFromFile, uniqueName } from "./image-names";
```

After `ImageInfo`, add:

```ts
/** The parts of a clip to change; a new `name` renames it in place. */
export interface ClipChanges {
  name?: string;
  frames?: number[];
  fps?: number;
  loop?: boolean;
}

/** A new record, so a rejected edit never touches the stored one. */
function withSheet(image: StoredImage, sheet: StoredSheet | undefined): StoredImage {
  return sheet ? { name: image.name, file: image.file, sheet } : { name: image.name, file: image.file };
}

function requireSheet(image: StoredImage): StoredSheet {
  if (!image.sheet) throw new Error("Set a frame size before adding clips");
  return image.sheet;
}

function requireClip(sheet: StoredSheet, clip: string): AnimationClip {
  if (!Object.hasOwn(sheet.animations, clip)) throw new Error(`Clip "${clip}" not found`);
  return sheet.animations[clip];
}
```

After `remove`, add the public edits:

```ts
  /** Both null makes it a single image again (only once it has no clips). */
  setFrameSize(name: string, width: number | null, height: number | null): Promise<void> {
    return this.edit(name, (image) => {
      if ((width === null) !== (height === null)) {
        throw new Error("Set both frame width and height, or neither");
      }
      if (width === null || height === null) {
        if (image.sheet && Object.keys(image.sheet.animations).length > 0) {
          throw new Error("Remove the clips before making this a single image");
        }
        return withSheet(image, undefined);
      }
      return withSheet(image, {
        frameWidth: width,
        frameHeight: height,
        animations: image.sheet?.animations ?? {},
      });
    });
  }

  /** Adds "clip" (or "clip-2"…) playing frame 0 at 8 fps, looping. Resolves to its name. */
  async addClip(name: string): Promise<string> {
    let added = "";
    await this.edit(name, (image) => {
      const sheet = requireSheet(image);
      added = uniqueName("clip", Object.keys(sheet.animations));
      return withSheet(image, {
        ...sheet,
        animations: { ...sheet.animations, [added]: { frames: [0], fps: 8, loop: true } },
      });
    });
    return added;
  }

  updateClip(name: string, clip: string, changes: ClipChanges): Promise<void> {
    return this.edit(name, (image) => {
      const sheet = requireSheet(image);
      const current = requireClip(sheet, clip);
      const newName = changes.name ?? clip;
      if (newName === "") throw new Error("Clip name can't be empty");
      if (newName !== clip && Object.hasOwn(sheet.animations, newName)) {
        throw new Error(`Clip "${newName}" already exists`);
      }
      const updated: AnimationClip = {
        frames: [...(changes.frames ?? current.frames)],
        fps: changes.fps ?? current.fps,
        loop: changes.loop ?? current.loop ?? true,
      };
      const animations: Record<string, AnimationClip> = {};
      for (const [key, value] of Object.entries(sheet.animations)) {
        if (key === clip) animations[newName] = updated;
        else animations[key] = value;
      }
      return withSheet(image, { ...sheet, animations });
    });
  }

  removeClip(name: string, clip: string): Promise<void> {
    return this.edit(name, (image) => {
      const sheet = requireSheet(image);
      requireClip(sheet, clip);
      const animations = { ...sheet.animations };
      delete animations[clip];
      return withSheet(image, { ...sheet, animations });
    });
  }
```

After `checkUploaded`, add the shared edit path:

```ts
  /**
   * Builds the next version of an uploaded, loaded image with `change`, checks it
   * against the image's size, saves it, then reloads it into Assets.
   */
  private edit(name: string, change: (image: StoredImage) => StoredImage): Promise<void> {
    return this.write(async () => {
      const current = this.checkUploaded(name);
      const { assets, store } = this.options;
      if (!assets.hasImage(name)) {
        throw new Error(`Image "${name}" could not be loaded; delete it and upload it again`);
      }
      const next = change(current);
      if (next.sheet) {
        const { width, height } = assets.getImage(name);
        checkSheet(name, width, height, next.sheet);
      }
      try {
        await store.save(next);
      } catch (error) {
        throw new Error(`Couldn't save image: ${messageOf(error)}`);
      }
      this.uploaded.set(name, next);
      await this.loadIntoAssets(next);
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass, then typecheck.**

Run: `npx vitest run tests/editor/image-library.test.ts`
Expected: PASS (all of Task 5 plus the 22 new tests, counting each `it.each` case).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add src/editor/image-library.ts tests/editor/image-library.test.ts
git commit -m "feat: ImageLibrary edits frame size and clips, checked before saving"
```

---

### Task 7: Images panel in the editor

The views run only in the browser and have no unit tests (as in milestone 5); they are verified in Chrome in Step 6.

**Files:**
- Create: `src/editor/views/image-list.ts`, `src/editor/views/image-details.ts`
- Modify: `src/editor/views/inspector.ts`, `src/editor/main.ts`, `editor.html`

**Interfaces:**
- Consumes:
  - from Tasks 5–6: `ImageLibrary` and `ClipChanges`;
  - from Task 3: `parseFrames`, `formatFrames`, `imageUsages` and `formatUsages`;
  - from Task 4: `EditorModel.allScenes`, `EditorModel.imagesChanged` and the `EditorModel` constructor's third argument;
  - from Task 2: `browserImageStore`.
- Produces:
  - `mountImageList(root: HTMLElement, library: ImageLibrary, model: EditorModel, assets: Assets): void`
  - `mountImageDetails(root: HTMLElement, library: ImageLibrary, model: EditorModel, assets: Assets, report: (message: string) => void): (name: string | null) => void`. It returns a `show` function.

- [ ] **Step 1: `editor.html`: a sidebar holding Entities and Images.** Replace the `body { … grid-template … }` rule and the `#entities { … }` rule with:

```css
      body {
        display: grid;
        grid-template: "top top top" auto "list view inspector" 1fr / 260px 1fr 280px;
      }
      #sidebar {
        grid-area: list;
        overflow: auto;
        padding: 8px;
        background: #18181b;
      }
      #sidebar h2 {
        margin: 4px 0;
        font-size: 13px;
        text-transform: uppercase;
        color: #a1a1aa;
      }
      #images {
        border-top: 1px solid #333;
        margin-top: 8px;
        padding-top: 8px;
      }
      .tag {
        margin-left: 6px;
        padding: 0 4px;
        border-radius: 3px;
        background: #3f3f46;
        font-size: 11px;
      }
      .error,
      .tag.error {
        color: #f87171;
      }
      input.invalid {
        outline: 2px solid #f87171;
      }
      .image-details canvas {
        display: block;
        margin: 6px 0;
        max-width: 100%;
        background: repeating-conic-gradient(#333 0 25%, #222 0 50%) 0 0 / 16px 16px;
      }
      .clip {
        display: grid;
        grid-template-columns: 1fr 1fr 44px auto auto;
        gap: 4px;
        align-items: center;
        margin: 3px 0;
      }
      .clip input {
        min-width: 0;
      }
      .frame-size {
        display: flex;
        gap: 4px;
        align-items: center;
      }
      .frame-size input {
        width: 56px;
      }
```

Then replace `<aside id="entities"></aside>` with:

```html
    <aside id="sidebar">
      <div id="entities"></div>
      <div id="images"></div>
    </aside>
```

- [ ] **Step 2: Inspector dropdowns follow image changes.** In `src/editor/views/inspector.ts`, in `shapeOf`, change the return to:

```ts
  return JSON.stringify([model.scene, index, components, model.imageNames]);
```

- [ ] **Step 3: Create `src/editor/views/image-details.ts`.**

```ts
import { checkSheet, type Assets } from "../../engine";
import { formatFrames, parseFrames } from "../frames-text";
import type { ClipChanges, ImageInfo, ImageLibrary } from "../image-library";
import { formatUsages, imageUsages } from "../image-usages";
import type { EditorModel } from "../model";

const PREVIEW_WIDTH = 240;
const PREVIEW_HEIGHT = 180;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The selected image: preview with numbered frames, frame size, clips, Delete.
 * Rebuilt when the image or its clip list changes; otherwise values are refreshed
 * in place, skipping the focused input and inputs showing a rejected value.
 */
export function mountImageDetails(
  root: HTMLElement,
  library: ImageLibrary,
  model: EditorModel,
  assets: Assets,
  report: (message: string) => void,
): (name: string | null) => void {
  root.className = "image-details";
  let current: string | null = null;
  let shape = "";
  let confirming = false;

  /** Runs a library write; marks `input` invalid with the message if it is rejected. */
  const attempt = (input: HTMLInputElement | null, write: () => Promise<unknown>) => {
    write().then(
      () => {
        input?.classList.remove("invalid");
        if (input) input.title = "";
        report("");
      },
      (error: unknown) => {
        input?.classList.add("invalid");
        if (input) input.title = messageOf(error);
        report(messageOf(error));
      },
    );
  };

  const build = (info: ImageInfo) => {
    root.replaceChildren();
    const readOnly = info.builtIn;

    if (info.error) {
      const error = document.createElement("p");
      error.className = "error";
      error.textContent = info.error;
      root.append(error);
    } else {
      root.append(preview(info, assets));
    }
    if (readOnly) {
      const note = document.createElement("p");
      note.textContent = "Defined in code";
      root.append(note);
    }

    if (!info.error) {
      const size = document.createElement("div");
      size.className = "frame-size";
      const width = numberInput("frameWidth", readOnly);
      const height = numberInput("frameHeight", readOnly);
      const commit = () => {
        const w = width.value === "" ? null : width.valueAsNumber;
        const h = height.value === "" ? null : height.valueAsNumber;
        attempt(width, () => library.setFrameSize(info.name, w, h));
      };
      width.addEventListener("change", commit);
      height.addEventListener("change", commit);
      size.append("Frame", width, "×", height);
      root.append(size);
    }

    if (info.sheet) {
      for (const clip of Object.keys(info.sheet.animations)) {
        root.append(clipRow(info.name, clip, readOnly));
      }
      if (!readOnly) {
        const add = document.createElement("button");
        add.textContent = "+ Add clip";
        add.addEventListener("click", () => attempt(null, () => library.addClip(info.name)));
        root.append(add);
      }
    }

    if (!readOnly) root.append(deleteControls(info.name));
  };

  const clipRow = (image: string, clip: string, readOnly: boolean) => {
    const row = document.createElement("div");
    row.className = "clip";
    row.dataset.clip = clip;
    const update = (input: HTMLInputElement, changes: () => ClipChanges | Error) => {
      input.addEventListener("change", () => {
        const next = changes();
        if (next instanceof Error) {
          attempt(input, () => Promise.reject(next));
        } else {
          attempt(input, () => library.updateClip(image, clip, next));
        }
      });
    };

    const name = textInput("name", readOnly);
    name.title = "Clip name";
    update(name, () => ({ name: name.value }));

    const frames = textInput("frames", readOnly);
    frames.title = "Frames, e.g. 2, 3, 4";
    update(frames, () => {
      const parsed = parseFrames(frames.value);
      return parsed === null ? new Error("Frames must be numbers like 2, 3, 4") : { frames: parsed };
    });

    const fps = numberInput("fps", readOnly);
    fps.title = "Frames per second";
    update(fps, () => ({ fps: fps.value === "" ? NaN : fps.valueAsNumber }));

    const loop = document.createElement("input");
    loop.type = "checkbox";
    loop.dataset.field = "loop";
    loop.title = "Loop";
    loop.disabled = readOnly;
    update(loop, () => ({ loop: loop.checked }));

    row.append(name, frames, fps, loop);
    if (!readOnly) {
      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.title = `Remove ${clip}`;
      remove.addEventListener("click", () => attempt(null, () => library.removeClip(image, clip)));
      row.append(remove);
    }
    return row;
  };

  const deleteControls = (name: string) => {
    const box = document.createElement("div");
    const remove = () => attempt(null, () => library.remove(name));
    if (!confirming) {
      const button = document.createElement("button");
      button.textContent = "Delete image";
      button.addEventListener("click", () => {
        if (imageUsages(name, model.allScenes(), model.registry).length === 0) {
          remove();
          return;
        }
        confirming = true;
        shape = "";
        show(current);
      });
      box.append(button);
      return box;
    }
    const usages = imageUsages(name, model.allScenes(), model.registry);
    const question = document.createElement("p");
    question.textContent = `Used by ${formatUsages(usages)}. Delete anyway?`;
    const yes = document.createElement("button");
    yes.textContent = "Delete";
    yes.addEventListener("click", () => {
      confirming = false;
      remove();
    });
    const no = document.createElement("button");
    no.textContent = "Cancel";
    no.addEventListener("click", () => {
      confirming = false;
      shape = "";
      show(current);
    });
    box.append(question, yes, no);
    return box;
  };

  /** Copies the image's values into the inputs. */
  const refresh = (info: ImageInfo) => {
    const set = (input: HTMLInputElement | null, value: string | boolean) => {
      if (!input || input === document.activeElement || input.classList.contains("invalid")) return;
      if (typeof value === "boolean") input.checked = value;
      else input.value = value;
    };
    const field = (scope: ParentNode, name: string) =>
      scope.querySelector<HTMLInputElement>(`[data-field="${name}"]`);
    set(field(root, "frameWidth"), info.sheet ? String(info.sheet.frameWidth) : "");
    set(field(root, "frameHeight"), info.sheet ? String(info.sheet.frameHeight) : "");
    for (const row of root.querySelectorAll<HTMLElement>(".clip")) {
      const clip = info.sheet?.animations[row.dataset.clip ?? ""];
      if (!clip) continue;
      set(field(row, "name"), row.dataset.clip ?? "");
      set(field(row, "frames"), formatFrames(clip.frames));
      set(field(row, "fps"), String(clip.fps));
      set(field(row, "loop"), clip.loop ?? true);
    }
    const canvas = root.querySelector("canvas");
    if (canvas) drawPreview(canvas, info, assets);
  };

  const show = (name: string | null) => {
    if (name !== current) confirming = false;
    current = name;
    if (name === null || !library.has(name)) {
      shape = "";
      root.replaceChildren();
      return;
    }
    const info = library.image(name);
    const next = JSON.stringify([
      name,
      info.error,
      info.sheet !== null,
      Object.keys(info.sheet?.animations ?? {}),
      confirming,
    ]);
    if (next !== shape) {
      shape = next;
      build(info);
    }
    refresh(info);
  };
  return show;
}

function numberInput(field: string, readOnly: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.dataset.field = field;
  input.disabled = readOnly;
  return input;
}

function textInput(field: string, readOnly: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.dataset.field = field;
  input.disabled = readOnly;
  return input;
}

function preview(info: ImageInfo, assets: Assets): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  drawPreview(canvas, info, assets);
  return canvas;
}

/** The image scaled to fit, with each frame outlined and numbered when it is a sheet. */
function drawPreview(canvas: HTMLCanvasElement, info: ImageInfo, assets: Assets): void {
  if (info.width === null || info.height === null || !assets.hasImage(info.name)) return;
  const scale = Math.min(PREVIEW_WIDTH / info.width, PREVIEW_HEIGHT / info.height, 8);
  canvas.width = Math.max(1, Math.round(info.width * scale));
  canvas.height = Math.max(1, Math.round(info.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(assets.getImage(info.name), 0, 0, canvas.width, canvas.height);
  if (!info.sheet) return;

  const { columns, count } = checkSheet(info.name, info.width, info.height, info.sheet);
  const w = info.sheet.frameWidth * scale;
  const h = info.sheet.frameHeight * scale;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.8)";
  ctx.lineWidth = 1;
  ctx.font = "10px monospace";
  ctx.textBaseline = "top";
  for (let index = 0; index < count; index++) {
    const x = (index % columns) * w;
    const y = Math.floor(index / columns) * h;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(x + 1, y + 1, 7 * String(index).length + 4, 12);
    ctx.fillStyle = "#fff";
    ctx.fillText(String(index), x + 3, y + 2);
  }
}
```

- [ ] **Step 4: Create `src/editor/views/image-list.ts`.**

```ts
import type { Assets } from "../../engine";
import type { ImageLibrary } from "../image-library";
import type { EditorModel } from "../model";
import { mountImageDetails } from "./image-details";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The Images panel: every image by name, Add image, and the selected image's details. */
export function mountImageList(
  root: HTMLElement,
  library: ImageLibrary,
  model: EditorModel,
  assets: Assets,
): void {
  let selected: string | null = null;
  let message = "";

  const title = document.createElement("h2");
  title.textContent = "Images";

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/*";
  picker.hidden = true;

  const add = document.createElement("button");
  add.textContent = "+ Add image";
  add.addEventListener("click", () => picker.click());

  const note = document.createElement("p");
  note.className = "error";

  const list = document.createElement("ul");
  const details = document.createElement("div");

  const report = (text: string) => {
    message = text;
    note.textContent = library.available
      ? message
      : ["Images can't be saved in this browser", message].filter(Boolean).join(". ");
  };
  const show = mountImageDetails(details, library, model, assets, report);

  picker.addEventListener("change", () => {
    for (const file of picker.files ?? []) {
      library.add(file, file.name).then(
        (name) => {
          selected = name;
          report("");
          update();
        },
        (error: unknown) => report(messageOf(error)),
      );
    }
    picker.value = "";
  });

  const update = () => {
    if (selected !== null && !library.has(selected)) selected = null;
    add.disabled = !library.available;
    report(message);
    list.replaceChildren();
    for (const name of library.names) {
      const info = library.image(name);
      const item = document.createElement("li");
      item.textContent = name;
      item.classList.toggle("selected", name === selected);
      if (info.builtIn) item.append(tag("code"));
      if (info.error) {
        const marker = tag("!");
        marker.classList.add("error");
        marker.title = info.error;
        item.append(marker);
      }
      item.addEventListener("click", () => {
        selected = selected === name ? null : name;
        update();
      });
      list.append(item);
    }
    show(selected);
  };

  root.replaceChildren(title, add, picker, note, list, details);
  library.onChange(update);
  update();
}

function tag(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "tag";
  span.textContent = text;
  return span;
}
```

- [ ] **Step 5: Wire it in `src/editor/main.ts`.** Replace the imports and the setup up to the `mount…` calls with the following. The Delete key handler stays as it is.

```ts
import { Assets, browserImageStore, browserSceneStore } from "../engine";
import { definition } from "../game/definition";
import { ImageLibrary } from "./image-library";
import { EditorModel } from "./model";
import { mountEntityList } from "./views/entity-list";
import { mountImageList } from "./views/image-list";
import { mountInspector } from "./views/inspector";
import { mountTopBar } from "./views/top-bar";
import { mountViewport } from "./views/viewport";

function element<T extends HTMLElement>(selector: string, type: new () => T): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Editor element not found: ${selector}`);
  return found;
}

const assets = new Assets();
const library = new ImageLibrary({
  builtIns: definition.images,
  store: await browserImageStore(),
  assets,
  createUrl: (file) => URL.createObjectURL(file),
});
const model = new EditorModel(definition, browserSceneStore(), () => library.names);
try {
  await library.load();
} catch (error) {
  document.body.textContent = `Failed to load images: ${
    error instanceof Error ? error.message : String(error)
  }`;
  throw error;
}
library.onChange(() => model.imagesChanged());

mountTopBar(element("#topbar", HTMLElement), model);
mountViewport(element("#viewport", HTMLCanvasElement), model, assets);
mountEntityList(element("#entities", HTMLElement), model);
mountImageList(element("#images", HTMLElement), library, model, assets);
mountInspector(element("#inspector", HTMLElement), model);
```

Then run `npm run typecheck && npm test`.
Expected: no type errors, and every test passes.

- [ ] **Step 6: Verify in Chrome.**
  1. Start `npm run dev` in the background, then open `http://localhost:5173/editor.html` in a new tab.
  2. Create the test sheet: run JavaScript in the page that draws a 64×32 canvas with eight 16×16 cells, each a different color with its index, and turns it into a `File` named `Slime Sheet.png` with `canvas.toBlob`.
  3. Put the file into the Images panel's `input[type=file]` with a `DataTransfer` (`input.files = dt.files; input.dispatchEvent(new Event("change"))`). Use the extension's `file_upload` tool if that's simpler.
  4. Check (by screenshot and JavaScript) that:
     - the list shows `background code`, `hero code` and `slime-sheet`, with `slime-sheet` selected;
     - the preview shows the sheet.
  5. Set the frame width and height to 16. Check that the grid shows the numbers 0–7.
  6. Add a clip, set its frames to `0, 1, 2, 3` and fps to 8. Check that `indexedDB` → `browser-engine` → `images` holds that record. Read it with `indexedDB.open` from JavaScript.
  7. Type frames `9` and press Tab. Check that the input turns red, the message reads `… frame 9 is out of range (8 frames)`, and the stored record is unchanged.
  8. Select the `Player` entity (play scene) or a new entity. In the inspector, check that the Sprite image dropdown lists `slime-sheet`. Pick it; the viewport draws it.
  9. Click `hero` in the Images list. Check that it shows read-only inputs and `Defined in code`, with no Delete button.
  10. Reload the page. The image, its frame size and its clip are still there.

  Fix any defect via a failing test first (systematic-debugging), then re-check.

- [ ] **Step 7: Commit.**

```bash
git add editor.html src/editor/main.ts src/editor/views/image-list.ts src/editor/views/image-details.ts src/editor/views/inspector.ts
git commit -m "feat: editor Images panel to upload images and edit their frames and clips"
```

---

### Task 8: The game page plays uploaded images

**Files:**
- Modify: `src/game/main.ts`

**Interfaces:**
- Consumes (from Task 2): `browserImageStore` and `toImageSources`.

- [ ] **Step 1: Load the stored images with the built-ins.** In `src/game/main.ts`:
  - change the engine import to `import { browserImageStore, browserSceneStore, Game, toImageSources } from "../engine";`;
  - inside the `try`, replace `await game.assets.loadImages(definition.images);` with:

```ts
  const stored = await (await browserImageStore()).list();
  await game.assets.loadImages(
    toImageSources(stored, definition.images, (file) => URL.createObjectURL(file)),
  );
```

- [ ] **Step 2: Check the whole build.**

Run: `npm run typecheck && npm test && npm run build`
Expected: no type errors, every test passes, and the build writes `dist/` with both pages.

- [ ] **Step 3: Verify end to end in Chrome**, continuing from Task 7's state:
  1. In the editor, on the play scene, give a new entity:
     - `Transform` (around 400, 300);
     - `Sprite` with image `slime-sheet` and width/height 64;
     - `Animator` with image `slime-sheet` and clip `clip`.
  2. Press **Play**, or open `http://localhost:5173/`.
  3. Go from the title scene to play (Enter/Space, as the demo does).
  4. Take two screenshots a moment apart. The entity should show different frames of the uploaded sheet, so it animates.
  5. Back in the editor, select `slime-sheet` and click **Delete image**. The confirmation should read `Used by <entity> (play). Delete anyway?`. Click **Cancel**, and the image should stay.
  6. Click **Delete image**, then **Delete**. The image should leave the list, and the viewport should show `Cannot draw this scene: Image "slime-sheet" is not loaded`, as it would for any unknown image.
  7. Remove that entity's Sprite and Animator so the demo is left clean.
  8. Stop the dev server.

- [ ] **Step 4: Commit.**

```bash
git add src/game/main.ts
git commit -m "feat: the game page loads images uploaded in the editor"
```
