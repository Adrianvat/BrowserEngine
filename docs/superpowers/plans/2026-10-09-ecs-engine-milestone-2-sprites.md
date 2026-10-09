# Browser ECS Engine — Milestone 2: Sprites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add image loading (single images and sprite sheets), a `Sprite` component with frames and flipping, a `Layer` component for draw order, and update the demo to use them.

**Architecture:** A new `Assets` resource loads images up front through an injectable loader and owns sheet frame math. The built-in `renderRects` system becomes `render`, which draws `Rect`s and `Sprite`s together sorted by `Layer` then entity ID. `Game` registers `Assets` (exposed as `game.assets`) and gains a `pixelArt` option.

**Tech Stack:** TypeScript 7 (strict), Vite 8, Vitest 5 (Node environment, no DOM emulation).

**Spec:** `docs/superpowers/specs/2026-10-09-ecs-engine-milestone-2-sprites-design.md` (builds on `docs/superpowers/specs/2026-10-09-ecs-engine-milestone-1-design.md`)

## Global Constraints

- TypeScript only, `strict: true`. No runtime dependencies.
- 2D Canvas only.
- `src/game/**` imports engine code only from `../engine` (`src/engine/index.ts`).
- Programmer errors throw `Error` with the exact messages given in the spec.
- `npm test` and `npm run typecheck` pass at the end of every task; `npm run build` passes at the end of Task 4.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Pxt2G9uuDdkshuneCFv8k8
  ```

## Review Focus

1. **A typo in an image name, or a frame index past the end of a sheet** (e.g. an off-by-one in future animation) — must throw an error naming the image, never draw nothing silently. Tests: Task 1 "unknown names throw" and "out-of-range, negative, and non-integer frames throw"; Task 2 "throws for a sprite whose image is not loaded".
2. **One missing file among several in a `loadImages` call** — the batch rejects naming that file; nothing from the batch is registered; earlier loads survive. Test: Task 1 "is all-or-nothing".
3. **An SVG without `width`/`height` (no intrinsic size)** — clear error at load time instead of an invisible sprite. Test: Task 1 "rejects a single image with no size".
4. **A flipped sprite drawn at a size different from its frame** — must mirror in place with its top-left corner at `Transform`. Tests: Task 2 "flipX mirrors…", "flipY mirrors…", "flipX and flipY together".
5. **A sheet whose size isn't a multiple of the frame size** — partial edge frames ignored, frame count correct. Test: Task 1 "ignores partial frames at the right and bottom edges".

---

## File Structure

```
src/engine/assets/assets.ts          Assets, ImageLoader, ImageSource, SheetSource, Frame (Task 1)
src/engine/render/components.ts      + Sprite, SpriteOptions, Layer (Task 2)
src/engine/render/systems.ts         renderRects → render (Task 2)
src/engine/core/game.ts              uses render (Task 2); assets + pixelArt (Task 3)
src/engine/index.ts                  new exports (Task 3)
src/game/systems.ts                  bounce simplified, + clampPlayer, playerAppearance (Task 4)
src/game/main.ts                     loads images, sprites, layers (Task 4)
public/background.svg, public/hero.svg  (Task 4)
tests/helpers/recording-canvas.ts    fake Canvas recording draw calls (Task 2)
tests/engine/assets.test.ts          (Task 1)
tests/engine/render.test.ts          (Task 2)
tests/engine/game.test.ts            + setup tests (Task 3)
tests/game/systems.test.ts           + playerAppearance, clampPlayer tests (Task 4)
```

---

### Task 1: Assets resource

**Files:**
- Create: `src/engine/assets/assets.ts`
- Test: `tests/engine/assets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ImageLoader = (url: string) => Promise<HTMLImageElement>`
  - `interface SheetSource { url: string; frameWidth: number; frameHeight: number }`
  - `type ImageSource = string | SheetSource`
  - `interface Frame { sx: number; sy: number; sw: number; sh: number }`
  - `function loadBrowserImage(url: string): Promise<HTMLImageElement>`
  - `class Assets { constructor(loader: ImageLoader = loadBrowserImage); loadImages(sources: Record<string, ImageSource>): Promise<void>; getImage(name: string): HTMLImageElement; hasImage(name: string): boolean; frameCount(name: string): number; getFrame(name: string, index: number): Frame }`

- [ ] **Step 1: Write the failing tests**

`tests/engine/assets.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/engine/assets/assets`.

- [ ] **Step 3: Implement**

`src/engine/assets/assets.ts`:
```ts
/** Loads one image file. The default uses the browser's Image element. */
export type ImageLoader = (url: string) => Promise<HTMLImageElement>;

/** An image split into a grid of equal-size frames. */
export interface SheetSource {
  url: string;
  frameWidth: number;
  frameHeight: number;
}

/** A plain URL loads a single image; a SheetSource loads a sprite sheet. */
export type ImageSource = string | SheetSource;

/** The part of an image to draw, in source pixels. */
export interface Frame {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface LoadedImage {
  image: HTMLImageElement;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  count: number;
}

export async function loadBrowserImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** Images loaded before the game starts, stored as a World resource. */
export class Assets {
  private readonly images = new Map<string, LoadedImage>();

  constructor(private readonly loader: ImageLoader = loadBrowserImage) {}

  /**
   * Loads all images in parallel. If any fails, none of them are kept and the
   * promise rejects with an error naming the image.
   */
  async loadImages(sources: Record<string, ImageSource>): Promise<void> {
    const loaded = await Promise.all(
      Object.entries(sources).map(
        async ([name, source]) => [name, await this.loadOne(name, source)] as const,
      ),
    );
    for (const [name, image] of loaded) this.images.set(name, image);
  }

  getImage(name: string): HTMLImageElement {
    return this.entry(name).image;
  }

  hasImage(name: string): boolean {
    return this.images.has(name);
  }

  frameCount(name: string): number {
    return this.entry(name).count;
  }

  /** Frames are numbered from 0, left to right, then top to bottom. */
  getFrame(name: string, index: number): Frame {
    const { frameWidth, frameHeight, columns, count } = this.entry(name);
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      const frames = count === 1 ? "1 frame" : `${count} frames`;
      throw new Error(`Frame ${index} is out of range for "${name}" (${frames})`);
    }
    return {
      sx: (index % columns) * frameWidth,
      sy: Math.floor(index / columns) * frameHeight,
      sw: frameWidth,
      sh: frameHeight,
    };
  }

  private entry(name: string): LoadedImage {
    const entry = this.images.get(name);
    if (!entry) throw new Error(`Image "${name}" is not loaded`);
    return entry;
  }

  private async loadOne(name: string, source: ImageSource): Promise<LoadedImage> {
    const url = typeof source === "string" ? source : source.url;
    if (
      typeof source !== "string" &&
      !(isPositiveInteger(source.frameWidth) && isPositiveInteger(source.frameHeight))
    ) {
      throw new Error(`Invalid frame size for image "${name}"`);
    }

    let image: HTMLImageElement;
    try {
      image = await this.loader(url);
    } catch (cause) {
      throw new Error(`Failed to load image "${name}" from ${url}`, { cause });
    }
    const { width, height } = image;

    if (typeof source === "string") {
      if (width === 0 || height === 0) {
        throw new Error(`Image "${name}" has no size (${width}x${height})`);
      }
      return { image, frameWidth: width, frameHeight: height, columns: 1, count: 1 };
    }

    const { frameWidth, frameHeight } = source;
    const columns = Math.floor(width / frameWidth);
    const rows = Math.floor(height / frameHeight);
    if (columns === 0 || rows === 0) {
      throw new Error(
        `Image "${name}" (${width}x${height}) is smaller than one ${frameWidth}x${frameHeight} frame`,
      );
    }
    return { image, frameWidth, frameHeight, columns, count: columns * rows };
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test` → Expected: PASS (53 tests: 42 existing + 11 new).
Run: `npm run typecheck` → Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/engine/assets/assets.ts tests/engine/assets.test.ts
git commit -m "feat(assets): add Assets resource with images and sprite sheets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Pxt2G9uuDdkshuneCFv8k8"
```

---

### Task 2: Sprite and Layer components, layered render system

**Files:**
- Modify: `src/engine/render/components.ts` (append)
- Modify: `src/engine/render/systems.ts` (replace contents)
- Modify: `src/engine/core/game.ts` (import and use `render` instead of `renderRects`)
- Create: `tests/helpers/recording-canvas.ts`
- Test: `tests/engine/render.test.ts`

**Interfaces:**
- Consumes: `Assets` (`getImage`, `getFrame`) from Task 1; `World`, `Entity`; `Canvas`, `Transform`, `Rect` (milestone 1).
- Produces:
  - `interface SpriteOptions { frame?: number; width?: number; height?: number; flipX?: boolean; flipY?: boolean }`
  - `class Sprite { image: string; frame: number; width?: number; height?: number; flipX: boolean; flipY: boolean; constructor(image: string, options?: SpriteOptions) }`
  - `class Layer { value: number }` — `new Layer(value = 0)`
  - `function render(world: World): void` (replaces `renderRects`)
  - Test helper `recordingCanvas(width?: number, height?: number): { canvas: Canvas; calls: Call[] }` where `type Call = [string, ...unknown[]]`; `fillRect` calls record the current `fillStyle` as their first argument.

- [ ] **Step 1: Write the test helper and failing tests**

`tests/helpers/recording-canvas.ts`:
```ts
import { Canvas } from "../../src/engine/render/canvas";

export type Call = [string, ...unknown[]];

/** Stands in for CanvasRenderingContext2D and records every drawing call. */
class RecordingContext {
  fillStyle = "";
  imageSmoothingEnabled = true;
  readonly calls: Call[] = [];

  clearRect(...args: unknown[]): void {
    this.calls.push(["clearRect", ...args]);
  }
  fillRect(...args: unknown[]): void {
    this.calls.push(["fillRect", this.fillStyle, ...args]);
  }
  drawImage(...args: unknown[]): void {
    this.calls.push(["drawImage", ...args]);
  }
  save(): void {
    this.calls.push(["save"]);
  }
  restore(): void {
    this.calls.push(["restore"]);
  }
  translate(...args: unknown[]): void {
    this.calls.push(["translate", ...args]);
  }
  scale(...args: unknown[]): void {
    this.calls.push(["scale", ...args]);
  }
}

/** A real Canvas resource backed by a recording context instead of a browser canvas. */
export function recordingCanvas(width = 100, height = 100): { canvas: Canvas; calls: Call[] } {
  const ctx = new RecordingContext();
  const element = { width: 0, height: 0, getContext: () => ctx };
  return {
    canvas: new Canvas(element as unknown as HTMLCanvasElement, width, height),
    calls: ctx.calls,
  };
}
```

`tests/engine/render.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Assets } from "../../src/engine/assets/assets";
import { World } from "../../src/engine/ecs/world";
import { Layer, Rect, Sprite, Transform } from "../../src/engine/render/components";
import { render } from "../../src/engine/render/systems";
import { recordingCanvas } from "../helpers/recording-canvas";

const bgImage = { width: 50, height: 40 } as HTMLImageElement;
const heroImage = { width: 64, height: 32 } as HTMLImageElement; // 4x2 frames of 16x16

async function setup() {
  const world = new World();
  const { canvas, calls } = recordingCanvas(100, 100);
  const files: Record<string, HTMLImageElement> = { "/bg.png": bgImage, "/hero.png": heroImage };
  const assets = new Assets(async (url) => files[url]);
  await assets.loadImages({
    bg: "/bg.png",
    hero: { url: "/hero.png", frameWidth: 16, frameHeight: 16 },
  });
  world.setResource(canvas);
  world.setResource(assets);

  const spawn = (...components: object[]) => {
    const entity = world.spawn();
    for (const component of components) world.add(entity, component);
    return entity;
  };
  /** Calls after the initial clearRect. */
  const draws = () => calls.slice(1);
  /** Short names for draw order checks: the rect's color, or "drawImage". */
  const order = () => draws().map((call) => (call[0] === "fillRect" ? call[1] : call[0]));
  return { world, calls, spawn, draws, order };
}

describe("render", () => {
  it("clears the whole canvas first", async () => {
    const { world, calls } = await setup();
    render(world);
    expect(calls).toEqual([["clearRect", 0, 0, 100, 100]]);
  });

  it("still draws rects", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Transform(1, 2), new Rect(3, 4, "red"));
    render(world);
    expect(draws()).toEqual([["fillRect", "red", 1, 2, 3, 4]]);
  });

  it("draws a single image at its natural size", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Transform(5, 6), new Sprite("bg"));
    render(world);
    expect(draws()).toEqual([["drawImage", bgImage, 0, 0, 50, 40, 5, 6, 50, 40]]);
  });

  it("draws the chosen sheet frame at an explicit size", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Transform(0, 0), new Sprite("hero", { frame: 5, width: 32, height: 24 }));
    render(world);
    expect(draws()).toEqual([["drawImage", heroImage, 16, 16, 16, 16, 0, 0, 32, 24]]);
  });

  it("flipX mirrors the sprite in place", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Transform(10, 20), new Sprite("hero", { width: 32, height: 24, flipX: true }));
    render(world);
    expect(draws()).toEqual([
      ["save"],
      ["translate", 42, 20],
      ["scale", -1, 1],
      ["drawImage", heroImage, 0, 0, 16, 16, 0, 0, 32, 24],
      ["restore"],
    ]);
  });

  it("flipY mirrors the sprite in place", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Transform(10, 20), new Sprite("hero", { width: 32, height: 24, flipY: true }));
    render(world);
    expect(draws()).toEqual([
      ["save"],
      ["translate", 10, 44],
      ["scale", 1, -1],
      ["drawImage", heroImage, 0, 0, 16, 16, 0, 0, 32, 24],
      ["restore"],
    ]);
  });

  it("flipX and flipY together", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Transform(10, 20), new Sprite("bg", { flipX: true, flipY: true }));
    render(world);
    expect(draws()).toEqual([
      ["save"],
      ["translate", 60, 60],
      ["scale", -1, -1],
      ["drawImage", bgImage, 0, 0, 50, 40, 0, 0, 50, 40],
      ["restore"],
    ]);
  });

  it("draws lower layers first, then by spawn order", async () => {
    const { world, spawn, order } = await setup();
    spawn(new Transform(), new Rect(1, 1, "top"), new Layer(1));
    spawn(new Transform(), new Rect(1, 1, "middle-a"));
    spawn(new Transform(), new Sprite("bg"), new Layer(-1));
    spawn(new Transform(), new Rect(1, 1, "middle-b"), new Layer(0));
    render(world);
    expect(order()).toEqual(["drawImage", "middle-a", "middle-b", "top"]);
  });

  it("orders by spawn order within a layer, not by component kind", async () => {
    const { world, spawn, order } = await setup();
    spawn(new Transform(), new Sprite("bg"));
    spawn(new Transform(), new Rect(1, 1, "red"));
    render(world);
    expect(order()).toEqual(["drawImage", "red"]);
  });

  it("draws an entity's rect under its own sprite", async () => {
    const { world, spawn, order } = await setup();
    spawn(new Transform(), new Sprite("bg"), new Rect(1, 1, "red"));
    render(world);
    expect(order()).toEqual(["red", "drawImage"]);
  });

  it("skips entities without a Transform", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Sprite("bg"));
    spawn(new Rect(1, 1, "red"));
    render(world);
    expect(draws()).toEqual([]);
  });

  it("throws for a sprite whose image is not loaded", async () => {
    const { world, spawn } = await setup();
    spawn(new Transform(), new Sprite("nope"));
    expect(() => render(world)).toThrow('Image "nope" is not loaded');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `render.test.ts` fails to import (`Layer`/`Sprite`/`render` are not exported). All other test files pass.

- [ ] **Step 3: Implement the components**

Append to `src/engine/render/components.ts`:
```ts

export interface SpriteOptions {
  /** Frame of a sprite sheet to show. Defaults to 0. */
  frame?: number;
  /** Drawn size in pixels. Defaults to the frame's own size. */
  width?: number;
  height?: number;
  /** Mirror the sprite. Its top-left corner stays at the Transform. */
  flipX?: boolean;
  flipY?: boolean;
}

/** Draws an image (or one frame of a sprite sheet) loaded through Assets. */
export class Sprite {
  frame: number;
  width?: number;
  height?: number;
  flipX: boolean;
  flipY: boolean;

  constructor(
    public image: string,
    options: SpriteOptions = {},
  ) {
    this.frame = options.frame ?? 0;
    this.width = options.width;
    this.height = options.height;
    this.flipX = options.flipX ?? false;
    this.flipY = options.flipY ?? false;
  }
}

/** Draw order: lower layers are drawn first. Entities without a Layer are on 0. */
export class Layer {
  constructor(public value = 0) {}
}
```

- [ ] **Step 4: Implement the render system**

Replace the contents of `src/engine/render/systems.ts`:
```ts
import { Assets } from "../assets/assets";
import type { Entity, World } from "../ecs/world";
import { Canvas } from "./canvas";
import { Layer, Rect, Sprite, Transform } from "./components";

interface DrawItem {
  layer: number;
  entity: Entity;
  draw: () => void;
}

/**
 * Built-in render system: clears the canvas, then draws every Rect and Sprite
 * by layer, then spawn order.
 */
export function render(world: World): void {
  const { ctx, width, height } = world.getResource(Canvas);
  ctx.clearRect(0, 0, width, height);

  const items: DrawItem[] = [];
  for (const [entity, transform, rect] of world.query(Transform, Rect)) {
    items.push({
      layer: layerOf(world, entity),
      entity,
      draw: () => {
        ctx.fillStyle = rect.color;
        ctx.fillRect(transform.x, transform.y, rect.width, rect.height);
      },
    });
  }

  const sprites = world.query(Transform, Sprite);
  if (sprites.length > 0) {
    const assets = world.getResource(Assets);
    for (const [entity, transform, sprite] of sprites) {
      items.push({
        layer: layerOf(world, entity),
        entity,
        draw: () => drawSprite(ctx, assets, transform, sprite),
      });
    }
  }

  // sort() is stable and rects were added first, so an entity's rect is drawn under its sprite.
  items.sort((a, b) => a.layer - b.layer || a.entity - b.entity);
  for (const item of items) item.draw();
}

function layerOf(world: World, entity: Entity): number {
  return world.get(entity, Layer)?.value ?? 0;
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  transform: Transform,
  sprite: Sprite,
): void {
  const image = assets.getImage(sprite.image);
  const { sx, sy, sw, sh } = assets.getFrame(sprite.image, sprite.frame);
  const w = sprite.width ?? sw;
  const h = sprite.height ?? sh;

  if (!sprite.flipX && !sprite.flipY) {
    ctx.drawImage(image, sx, sy, sw, sh, transform.x, transform.y, w, h);
    return;
  }
  // Mirror around the sprite's own box so its top-left corner stays put.
  ctx.save();
  ctx.translate(transform.x + (sprite.flipX ? w : 0), transform.y + (sprite.flipY ? h : 0));
  ctx.scale(sprite.flipX ? -1 : 1, sprite.flipY ? -1 : 1);
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
  ctx.restore();
}
```

In `src/engine/core/game.ts`, change:
```ts
import { renderRects } from "../render/systems";
```
to:
```ts
import { render } from "../render/systems";
```
and:
```ts
  private readonly renderSystems: System[] = [renderRects];
```
to:
```ts
  private readonly renderSystems: System[] = [render];
```
and the doc comment on `addRenderSystem` from "after the built-in rect renderer" to "after the built-in renderer".

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test` → Expected: PASS (65 tests).
Run: `npm run typecheck` → Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/engine/render src/engine/core/game.ts tests/helpers tests/engine/render.test.ts
git commit -m "feat(render): add Sprite and Layer, draw rects and sprites by layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Pxt2G9uuDdkshuneCFv8k8"
```

---

### Task 3: Game wiring (assets, pixelArt) and public API

**Files:**
- Modify: `src/engine/core/game.ts`
- Modify: `src/engine/index.ts`
- Test: `tests/engine/game.test.ts` (append)

**Interfaces:**
- Consumes: `Assets` (Task 1); `Sprite`, `Layer`, `SpriteOptions` (Task 2).
- Produces:
  - `GameOptions.pixelArt?: boolean`
  - `Game.assets: Assets` (same instance as `world.getResource(Assets)`)
  - `src/engine/index.ts` additionally exports `Assets`, `Sprite`, `Layer`, and types `Frame`, `ImageLoader`, `ImageSource`, `SheetSource`, `SpriteOptions`.

- [ ] **Step 1: Write the failing tests**

In `tests/engine/game.test.ts`, add these imports below the existing ones:
```ts
import { Assets } from "../../src/engine/assets/assets";
import { Canvas } from "../../src/engine/render/canvas";
```

Append:
```ts
describe("Game setup", () => {
  it("exposes the Assets resource as game.assets", () => {
    const game = makeGame();
    expect(game.assets).toBeInstanceOf(Assets);
    expect(game.world.getResource(Assets)).toBe(game.assets);
  });

  it("keeps image smoothing on by default", () => {
    const game = makeGame();
    expect(game.world.getResource(Canvas).ctx.imageSmoothingEnabled).toBe(true);
  });

  it("pixelArt turns image smoothing off", () => {
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    const game = new Game({ canvas, width: 100, height: 100, pixelArt: true });
    expect(game.world.getResource(Canvas).ctx.imageSmoothingEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — 3 failures in "Game setup" (`game.assets` is undefined; `imageSmoothingEnabled` is undefined).

- [ ] **Step 3: Implement**

In `src/engine/core/game.ts`, add the import:
```ts
import { Assets } from "../assets/assets";
```

Add to `GameOptions`:
```ts
  /** Turn off image smoothing so scaled-up pixel art stays sharp. */
  pixelArt?: boolean;
```

Add a field below `readonly world = new World();`:
```ts
  readonly assets = new Assets();
```

Replace in the constructor:
```ts
    this.world.setResource(new Canvas(element, options.width, options.height));
    this.world.setResource(this.keyboard);
```
with:
```ts
    const canvas = new Canvas(element, options.width, options.height);
    canvas.ctx.imageSmoothingEnabled = !options.pixelArt;
    this.world.setResource(canvas);
    this.world.setResource(this.assets);
    this.world.setResource(this.keyboard);
```

Replace `src/engine/index.ts`:
```ts
export { World } from "./ecs/world";
export type { Entity, ComponentType, System } from "./ecs/world";
export { Game } from "./core/game";
export type { GameOptions } from "./core/game";
export { FIXED_STEP } from "./core/timestep";
export { Keyboard } from "./input/keyboard";
export { Assets } from "./assets/assets";
export type { Frame, ImageLoader, ImageSource, SheetSource } from "./assets/assets";
export { Canvas } from "./render/canvas";
export { Transform, Rect, Sprite, Layer } from "./render/components";
export type { SpriteOptions } from "./render/components";
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test` → Expected: PASS (68 tests).
Run: `npm run typecheck` → Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/engine/core/game.ts src/engine/index.ts tests/engine/game.test.ts
git commit -m "feat(engine): register Assets, add pixelArt option, export sprite API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Pxt2G9uuDdkshuneCFv8k8"
```

---

### Task 4: Demo uses sprites

**Files:**
- Create: `public/background.svg`, `public/hero.svg`
- Modify: `src/game/systems.ts`
- Modify: `src/game/main.ts` (replace contents)
- Test: `tests/game/systems.test.ts` (modify imports, append)

**Interfaces:**
- Consumes (via `../engine`): `Assets`, `Canvas`, `Keyboard`, `Layer`, `Rect`, `Sprite`, `Transform`, `World`, `Game`; test helper `recordingCanvas` (Task 2).
- Produces: demo systems `bounce(world)` (rects only), `clampPlayer(world)`, `playerAppearance(world)`; existing `playerInput`, `movement`, `PLAYER_SPEED` unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/game/systems.test.ts`, replace the import lines with:
```ts
import { describe, it, expect } from "vitest";
import { Assets, Keyboard, Sprite, Transform, World } from "../../src/engine";
import { Player, Velocity } from "../../src/game/components";
import {
  clampPlayer,
  movement,
  playerAppearance,
  playerInput,
  PLAYER_SPEED,
} from "../../src/game/systems";
import { recordingCanvas } from "../helpers/recording-canvas";
```

Append:
```ts
describe("playerAppearance", () => {
  function setup() {
    const world = new World();
    const player = world.spawn();
    const velocity = new Velocity();
    const sprite = new Sprite("hero");
    world.add(player, new Player());
    world.add(player, velocity);
    world.add(player, sprite);
    return { world, velocity, sprite };
  }

  it("shows the moving frame while moving and the standing frame when still", () => {
    const { world, velocity, sprite } = setup();
    velocity.y = 10;
    playerAppearance(world);
    expect(sprite.frame).toBe(1);
    velocity.y = 0;
    playerAppearance(world);
    expect(sprite.frame).toBe(0);
  });

  it("faces the way it moves horizontally and keeps facing otherwise", () => {
    const { world, velocity, sprite } = setup();
    velocity.x = -10;
    playerAppearance(world);
    expect(sprite.flipX).toBe(true);

    velocity.x = 0;
    playerAppearance(world);
    expect(sprite.flipX).toBe(true);

    velocity.y = 10;
    playerAppearance(world);
    expect(sprite.flipX).toBe(true);

    velocity.x = 10;
    playerAppearance(world);
    expect(sprite.flipX).toBe(false);
  });
});

describe("clampPlayer", () => {
  async function setup(sprite: Sprite, x: number, y: number) {
    const world = new World();
    world.setResource(recordingCanvas(100, 100).canvas);
    const assets = new Assets(async () => ({ width: 32, height: 16 }) as HTMLImageElement);
    await assets.loadImages({ hero: { url: "/hero.svg", frameWidth: 16, frameHeight: 16 } });
    world.setResource(assets);
    const player = world.spawn();
    const transform = new Transform(x, y);
    world.add(player, new Player());
    world.add(player, transform);
    world.add(player, sprite);
    return { world, transform };
  }

  it("keeps the player inside the canvas using the sprite's explicit size", async () => {
    const { world, transform } = await setup(new Sprite("hero", { width: 32, height: 32 }), 90, -5);
    clampPlayer(world);
    expect([transform.x, transform.y]).toEqual([68, 0]);
  });

  it("uses the frame's own size when the sprite has no explicit size", async () => {
    const { world, transform } = await setup(new Sprite("hero"), 95, 95);
    clampPlayer(world);
    expect([transform.x, transform.y]).toEqual([84, 84]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the new `playerAppearance` and `clampPlayer` tests fail with "is not a function"; earlier `movement`/`playerInput` tests still pass.

- [ ] **Step 3: Implement the systems**

Replace `src/game/systems.ts`:
```ts
import { Assets, Canvas, Keyboard, Rect, Sprite, Transform, type World } from "../engine";
import { Player, Velocity } from "./components";

export const PLAYER_SPEED = 300;

/** Frames in hero.svg. */
const STANDING_FRAME = 0;
const MOVING_FRAME = 1;

export function playerInput(world: World): void {
  const keyboard = world.getResource(Keyboard);
  for (const [, , velocity] of world.query(Player, Velocity)) {
    let dx = 0;
    let dy = 0;
    if (keyboard.isDown("ArrowLeft") || keyboard.isDown("KeyA")) dx -= 1;
    if (keyboard.isDown("ArrowRight") || keyboard.isDown("KeyD")) dx += 1;
    if (keyboard.isDown("ArrowUp") || keyboard.isDown("KeyW")) dy -= 1;
    if (keyboard.isDown("ArrowDown") || keyboard.isDown("KeyS")) dy += 1;
    velocity.x = dx * PLAYER_SPEED;
    velocity.y = dy * PLAYER_SPEED;
  }
}

export function movement(world: World, dt: number): void {
  for (const [, transform, velocity] of world.query(Transform, Velocity)) {
    transform.x += velocity.x * dt;
    transform.y += velocity.y * dt;
  }
}

/** Bounces moving rects off the canvas edges. */
export function bounce(world: World): void {
  const { width, height } = world.getResource(Canvas);
  for (const [, transform, rect, velocity] of world.query(Transform, Rect, Velocity)) {
    const maxX = width - rect.width;
    const maxY = height - rect.height;
    if (transform.x < 0) {
      transform.x = 0;
      velocity.x = Math.abs(velocity.x);
    } else if (transform.x > maxX) {
      transform.x = maxX;
      velocity.x = -Math.abs(velocity.x);
    }
    if (transform.y < 0) {
      transform.y = 0;
      velocity.y = Math.abs(velocity.y);
    } else if (transform.y > maxY) {
      transform.y = maxY;
      velocity.y = -Math.abs(velocity.y);
    }
  }
}

/** Keeps the player inside the canvas, using its sprite's drawn size. */
export function clampPlayer(world: World): void {
  const { width, height } = world.getResource(Canvas);
  const assets = world.getResource(Assets);
  for (const [, , transform, sprite] of world.query(Player, Transform, Sprite)) {
    const frame = assets.getFrame(sprite.image, sprite.frame);
    const maxX = width - (sprite.width ?? frame.sw);
    const maxY = height - (sprite.height ?? frame.sh);
    transform.x = Math.min(Math.max(transform.x, 0), maxX);
    transform.y = Math.min(Math.max(transform.y, 0), maxY);
  }
}

/** Picks the player's frame and facing from its velocity. */
export function playerAppearance(world: World): void {
  for (const [, , velocity, sprite] of world.query(Player, Velocity, Sprite)) {
    const moving = velocity.x !== 0 || velocity.y !== 0;
    sprite.frame = moving ? MOVING_FRAME : STANDING_FRAME;
    if (velocity.x < 0) sprite.flipX = true;
    else if (velocity.x > 0) sprite.flipX = false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` → Expected: PASS (72 tests).

- [ ] **Step 5: Add the art**

`public/background.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1e1b4b" />
      <stop offset="1" stop-color="#4338ca" />
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#sky)" />
  <g fill="#e0e7ff">
    <circle cx="70" cy="60" r="2" />
    <circle cx="190" cy="120" r="1.5" />
    <circle cx="310" cy="45" r="2" />
    <circle cx="430" cy="150" r="1.5" />
    <circle cx="520" cy="70" r="2" />
    <circle cx="740" cy="200" r="1.5" />
    <circle cx="120" cy="230" r="1.5" />
    <circle cx="360" cy="260" r="2" />
  </g>
  <circle cx="660" cy="110" r="42" fill="#fef3c7" />
  <path d="M0 470 L120 400 L240 450 L380 370 L520 440 L660 390 L800 430 L800 600 L0 600 Z" fill="#1e293b" />
  <rect y="530" width="800" height="70" fill="#0f172a" />
</svg>
```

`public/hero.svg` (two 16×16 frames side by side, facing right; frame 0 standing, frame 1 mid-step):
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16" viewBox="0 0 32 16" shape-rendering="crispEdges">
  <!-- Frame 0: standing -->
  <rect x="5" y="1" width="6" height="5" fill="#fcd34d" />
  <rect x="9" y="3" width="1" height="1" fill="#111827" />
  <rect x="4" y="6" width="8" height="5" fill="#22c55e" />
  <rect x="5" y="11" width="2" height="4" fill="#1e3a8a" />
  <rect x="9" y="11" width="2" height="4" fill="#1e3a8a" />
  <!-- Frame 1: walking -->
  <g transform="translate(16 0)">
    <rect x="5" y="1" width="6" height="5" fill="#fcd34d" />
    <rect x="9" y="3" width="1" height="1" fill="#111827" />
    <rect x="4" y="6" width="8" height="5" fill="#22c55e" />
    <rect x="3" y="11" width="2" height="4" fill="#1e3a8a" />
    <rect x="10" y="11" width="2" height="3" fill="#1e3a8a" />
    <rect x="12" y="7" width="2" height="2" fill="#22c55e" />
  </g>
</svg>
```

- [ ] **Step 6: Update the entry point**

Replace `src/game/main.ts`:
```ts
import { Game, Layer, Rect, Sprite, Transform } from "../engine";
import { Player, Velocity } from "./components";
import { bounce, clampPlayer, movement, playerAppearance, playerInput } from "./systems";

const WIDTH = 800;
const HEIGHT = 600;
const PLAYER_SIZE = 32;

const game = new Game({ canvas: "#game", width: WIDTH, height: HEIGHT, pixelArt: true });
const world = game.world;

await game.assets.loadImages({
  background: "/background.svg",
  hero: { url: "/hero.svg", frameWidth: 16, frameHeight: 16 },
});

const background = world.spawn();
world.add(background, new Transform(0, 0));
world.add(background, new Sprite("background"));
world.add(background, new Layer(-1));

const player = world.spawn();
world.add(player, new Player());
world.add(player, new Transform((WIDTH - PLAYER_SIZE) / 2, (HEIGHT - PLAYER_SIZE) / 2));
world.add(player, new Sprite("hero", { width: PLAYER_SIZE, height: PLAYER_SIZE }));
world.add(player, new Layer(1));
world.add(player, new Velocity());

for (let i = 0; i < 10; i++) {
  const size = 12 + Math.random() * 24;
  const angle = Math.random() * Math.PI * 2;
  const speed = 80 + Math.random() * 160;
  const e = world.spawn();
  world.add(e, new Transform(Math.random() * (WIDTH - size), Math.random() * (HEIGHT - size)));
  world.add(e, new Rect(size, size, `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`));
  world.add(e, new Velocity(Math.cos(angle) * speed, Math.sin(angle) * speed));
}

game.addSystem(playerInput);
game.addSystem(movement);
game.addSystem(bounce);
game.addSystem(clampPlayer);
game.addSystem(playerAppearance);
game.start();
```

- [ ] **Step 7: Verify typecheck, tests, build**

Run: `npm run typecheck` → Expected: exit 0.
Run: `npm test` → Expected: PASS (72 tests).
Run: `npm run build` → Expected: exit 0; `dist/` contains `index.html`, `background.svg`, `hero.svg`, and an `assets/*.js` bundle.

- [ ] **Step 8: Verify in the browser**

Run `npm run dev` in the background and open `http://localhost:5173/`. Check:
- The night-sky background fills the 800×600 canvas, behind everything.
- The bouncing squares are drawn over the background.
- The player is a crisp (not blurry) 32×32 pixel-art character drawn on top of the squares.
- Moving (arrow keys/WASD) switches to the walking frame; stopping shows the standing frame.
- Moving left mirrors the character to face left; moving right faces right; stopping keeps the last facing.
- The player stops at all four canvas edges.
- No console errors.

Stop the dev server when done.

- [ ] **Step 9: Commit**

```bash
git add public src/game tests/game
git commit -m "feat(game): demo uses background and sprite-sheet player

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Pxt2G9uuDdkshuneCFv8k8"
```
