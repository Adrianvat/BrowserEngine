# Milestone 4: Scenes and Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split games into scenes (one running at a time, each with a fresh `World` and its own systems, data shared through global resources) and add a `Text` component.

**Architecture:** A `Scenes` resource records switch requests; `Game` owns the scene list, the global resources and the active scene (world + systems), and applies a requested switch at the end of a fixed step by building a new `World`, adding the global resources and running the scene's `setup`. The renderer gains a third drawable, `Text`.

**Tech Stack:** TypeScript 7 (strict), Vite 8, Vitest 5 (Node environment, no DOM), no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-10-ecs-engine-milestone-4-scenes-design.md`

## Global Constraints

- TypeScript only, strict; no runtime dependencies; Canvas 2D.
- Game code (`src/game/`) imports only from `src/engine/index.ts`.
- Error messages exactly: `Scene "<name>" is already added`, `Scene "<name>" not found`, `No scene is running`.
- `Text` defaults: size 16, color `"white"`, font `"sans-serif"`, align `"left"`; drawn with `textBaseline = "top"` and `ctx.font = "<size>px <font>"`.
- Within one entity the draw order is rect, sprite, text.
- Fixed-step order: scene systems → `animate` → keyboard end-of-step → pending scene switch.
- `game.addSystem` and `game.addRenderSystem` no longer exist.
- Verification commands: `npm test`, `npm run typecheck`, `npm run build`.

## Review Focus

- Steps left in a frame after a switch must run on the new scene, not the dropped one (Task 2 test).
- The frame that switches must render the new scene, not the old one (Task 2 test).
- Several `switchTo` calls in one step: only the last one takes effect, and the skipped scene's `setup` never runs (Task 2 test).
- An Enter press that triggers a switch must not be seen as pressed by the new scene (Task 2 test).
- `addGlobalResource` after `start` must reach the running scene's world, not only future ones (Task 2 test).

## File Structure

```
src/engine/render/components.ts      modify: + Text, TextOptions
src/engine/render/systems.ts         modify: draw Text
src/engine/scene/scene.ts            create: Scene, SceneContext, Scenes
src/engine/core/game.ts              modify: scenes, global resources, switching
src/engine/index.ts                  modify: exports
src/game/main.ts                     modify: scenes + global resource
src/game/resources.ts                create: Plays
src/game/scenes/play.ts              create: play scene + backToTitle
src/game/scenes/title.ts             create: title scene + startOnEnter
tests/helpers/recording-canvas.ts    modify: text state recording
tests/engine/render.test.ts          modify
tests/engine/game.test.ts            rewrite
tests/game/scenes.test.ts            create
```

---

### Task 1: `Text` component and drawing

**Files:**
- Modify: `src/engine/render/components.ts`
- Modify: `src/engine/render/systems.ts`
- Modify: `src/engine/index.ts`
- Modify: `tests/helpers/recording-canvas.ts`
- Test: `tests/engine/render.test.ts`

**Interfaces:**
- Consumes: existing `render`, `Transform`, `Layer`, `recordingCanvas`.
- Produces:
  - `export type TextAlign = "left" | "center" | "right"` (not exported from index; used by `Text`)
  - `export interface TextOptions { size?: number; color?: string; font?: string; align?: TextAlign }`
  - `export class Text { value: string; size: number; color: string; font: string; align: TextAlign; constructor(value: string, options?: TextOptions) }`
  - `recordingCanvas(w, h)` now returns `{ canvas, calls, texts }` where `texts: TextDraw[]` and `interface TextDraw { value: unknown; x: unknown; y: unknown; font: string; fillStyle: string; textAlign: string; textBaseline: string }`
  - `Text` and `type TextOptions` exported from `src/engine/index.ts`.

- [ ] **Step 1: Teach the recording canvas about text state**

Replace `tests/helpers/recording-canvas.ts` with:

```ts
import { Canvas } from "../../src/engine/render/canvas";

export type Call = [string, ...unknown[]];

/** One fillText call together with the text state it was drawn with. */
export interface TextDraw {
  value: unknown;
  x: unknown;
  y: unknown;
  font: string;
  fillStyle: string;
  textAlign: string;
  textBaseline: string;
}

/** Stands in for CanvasRenderingContext2D and records every drawing call. */
class RecordingContext {
  fillStyle = "";
  font = "";
  textAlign = "start";
  textBaseline = "alphabetic";
  imageSmoothingEnabled = true;
  readonly calls: Call[] = [];
  readonly texts: TextDraw[] = [];

  clearRect(...args: unknown[]): void {
    this.calls.push(["clearRect", ...args]);
  }
  fillRect(...args: unknown[]): void {
    this.calls.push(["fillRect", this.fillStyle, ...args]);
  }
  fillText(value: unknown, x: unknown, y: unknown): void {
    this.calls.push(["fillText", value, x, y]);
    const { font, fillStyle, textAlign, textBaseline } = this;
    this.texts.push({ value, x, y, font, fillStyle, textAlign, textBaseline });
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
export function recordingCanvas(
  width = 100,
  height = 100,
): { canvas: Canvas; calls: Call[]; texts: TextDraw[] } {
  const ctx = new RecordingContext();
  const element = { width: 0, height: 0, getContext: () => ctx };
  return {
    canvas: new Canvas(element as unknown as HTMLCanvasElement, width, height),
    calls: ctx.calls,
    texts: ctx.texts,
  };
}
```

Run: `npx vitest run tests/game/errors.test.ts tests/engine/render.test.ts`
Expected: PASS (existing tests unchanged by this helper change).

- [ ] **Step 2: Write the failing render tests**

In `tests/engine/render.test.ts`, change the components import to:

```ts
import { Layer, Rect, Sprite, Text, Transform } from "../../src/engine/render/components";
```

In `setup()`, change `const { canvas, calls } = recordingCanvas(100, 100);` to:

```ts
  const { canvas, calls, texts } = recordingCanvas(100, 100);
```

and its return line to:

```ts
  return { world, calls, texts, spawn, draws, order };
```

Add these tests inside `describe("render", ...)`, before its closing `});`:

```ts
  it("draws text at the Transform with its font, color, alignment and a top baseline", async () => {
    const { world, spawn, draws, texts } = await setup();
    spawn(
      new Transform(10, 20),
      new Text("Hi", { size: 24, color: "red", font: "monospace", align: "center" }),
    );
    render(world);
    expect(draws()).toEqual([["fillText", "Hi", 10, 20]]);
    expect(texts).toEqual([
      {
        value: "Hi",
        x: 10,
        y: 20,
        font: "24px monospace",
        fillStyle: "red",
        textAlign: "center",
        textBaseline: "top",
      },
    ]);
  });

  it("uses 16px white sans-serif, left-aligned, by default", async () => {
    const { world, spawn, texts } = await setup();
    spawn(new Transform(), new Text("a"));
    render(world);
    expect(texts[0]).toMatchObject({
      font: "16px sans-serif",
      fillStyle: "white",
      textAlign: "left",
    });
  });

  it("sorts text by layer with rects and sprites", async () => {
    const { world, spawn, order } = await setup();
    spawn(new Transform(), new Rect(1, 1, "red"));
    spawn(new Transform(), new Text("under"), new Layer(-1));
    spawn(new Transform(), new Sprite("bg"), new Layer(1));
    render(world);
    expect(order()).toEqual(["fillText", "red", "drawImage"]);
  });

  it("draws an entity's text on top of its own rect and sprite", async () => {
    const { world, spawn, order } = await setup();
    spawn(new Transform(), new Text("label"), new Sprite("bg"), new Rect(1, 1, "red"));
    render(world);
    expect(order()).toEqual(["red", "drawImage", "fillText"]);
  });

  it("skips text without a Transform", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Text("lost"));
    render(world);
    expect(draws()).toEqual([]);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/engine/render.test.ts`
Expected: FAIL — `Text` is not exported from `components` (`Text is not a constructor`), so the new tests fail; the existing ones pass.

- [ ] **Step 4: Add the component**

Append to `src/engine/render/components.ts`:

```ts
export type TextAlign = "left" | "center" | "right";

export interface TextOptions {
  /** Font size in pixels. Defaults to 16. */
  size?: number;
  /** CSS color. Defaults to "white". */
  color?: string;
  /** CSS font family. Defaults to "sans-serif". */
  font?: string;
  /** Whether the Transform's x is the text's left edge, center, or right edge. Defaults to "left". */
  align?: TextAlign;
}

/** Draws one line of text; the Transform is the top of the text. */
export class Text {
  size: number;
  color: string;
  font: string;
  align: TextAlign;

  constructor(
    public value: string,
    options: TextOptions = {},
  ) {
    this.size = options.size ?? 16;
    this.color = options.color ?? "white";
    this.font = options.font ?? "sans-serif";
    this.align = options.align ?? "left";
  }
}
```

- [ ] **Step 5: Draw it**

In `src/engine/render/systems.ts`:

Change the components import to:

```ts
import { Layer, Rect, Sprite, Text, Transform } from "./components";
```

Change the doc comment of `render` to:

```ts
/**
 * Built-in render system: clears the canvas, then draws every Rect, Sprite
 * and Text by layer, then spawn order.
 */
```

Replace the sort comment and the two lines after the sprites block:

```ts
  // sort() is stable and rects were added first, so an entity's rect is drawn under its sprite.
  items.sort((a, b) => a.layer - b.layer || a.entity - b.entity);
  for (const item of items) item.draw();
```

with:

```ts
  for (const [entity, transform, text] of world.query(Transform, Text)) {
    items.push({
      layer: layerOf(world, entity),
      entity,
      draw: () => drawText(ctx, transform, text),
    });
  }

  // sort() is stable and items were added rects, then sprites, then text, so within
  // one entity the text is on top of its sprite, which is on top of its rect.
  items.sort((a, b) => a.layer - b.layer || a.entity - b.entity);
  for (const item of items) item.draw();
```

Append to the file:

```ts
function drawText(ctx: CanvasRenderingContext2D, transform: Transform, text: Text): void {
  ctx.font = `${text.size}px ${text.font}`;
  ctx.fillStyle = text.color;
  ctx.textAlign = text.align;
  ctx.textBaseline = "top";
  ctx.fillText(text.value, transform.x, transform.y);
}
```

In `src/engine/index.ts`, change the render components lines to:

```ts
export { Transform, Rect, Sprite, Layer, Text } from "./render/components";
export type { SpriteOptions, TextOptions } from "./render/components";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/engine/render src/engine/index.ts tests/helpers/recording-canvas.ts tests/engine/render.test.ts
git commit -m "feat: Text component drawn by the renderer"
```

---

### Task 2: Scenes in the engine

**Files:**
- Create: `src/engine/scene/scene.ts`
- Modify: `src/engine/core/game.ts`
- Modify: `src/engine/index.ts`
- Create: `src/game/scenes/play.ts`
- Modify: `src/game/main.ts`
- Test: `tests/engine/game.test.ts` (rewrite)

**Interfaces:**
- Consumes: `World`, `System`, `render`, `animate`, `Canvas`, `Assets`, `Keyboard`, `advance`, `FIXED_STEP`.
- Produces:
  - `export interface Scene { setup(scene: SceneContext): void }`
  - `export interface SceneContext { readonly world: World; addSystem(system: System): void; addRenderSystem(system: System): void }`
  - `export class Scenes { constructor(exists: (name: string) => boolean); readonly current: string (getter); switchTo(name: string): void; enter(name: string): void; takeRequest(): string | null }` — `enter` and `takeRequest` are for `Game` (and tests).
  - `Game`: `readonly assets: Assets`, `readonly canvas: Canvas`, `get world(): World`, `addScene(name: string, scene: Scene): void`, `addGlobalResource(resource: object): void`, `start(sceneName: string): void`, `stop(): void`. No `addSystem`/`addRenderSystem`.
  - `src/game/scenes/play.ts`: `export const playScene: Scene` (the milestone 3 demo moved into a scene).
  - `Scenes` and `type Scene, SceneContext` exported from `src/engine/index.ts`.

- [ ] **Step 1: Write the failing tests**

Replace `tests/engine/game.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Animator } from "../../src/engine/animation/animator";
import { Assets } from "../../src/engine/assets/assets";
import { Game } from "../../src/engine/core/game";
import { FIXED_STEP } from "../../src/engine/core/timestep";
import type { World } from "../../src/engine/ecs/world";
import { Keyboard } from "../../src/engine/input/keyboard";
import { Canvas } from "../../src/engine/render/canvas";
import { Sprite } from "../../src/engine/render/components";
import { Scenes, type SceneContext } from "../../src/engine/scene/scene";

// Just enough of the browser for Game to run in Node.
class FakeCanvasElement {
  width = 0;
  height = 0;
  getContext() {
    return { fillStyle: "", clearRect() {}, fillRect() {} };
  }
}

let time = 0;
let nextFrameId = 1;
const pendingFrames = new Map<number, FrameRequestCallback>();

/** Advances the fake clock and runs every frame callback that was scheduled. */
function tick(ms: number): void {
  time += ms;
  const due = [...pendingFrames.values()];
  pendingFrames.clear();
  for (const callback of due) callback(time);
}

function makeGame(): Game {
  const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
  return new Game({ canvas, width: 100, height: 100 });
}

/** Adds a scene with this setup under `name` and starts the game with it. */
function startWith(game: Game, setup: (scene: SceneContext) => void, name = "main"): void {
  game.addScene(name, { setup });
  game.start(name);
}

/** A key going down on the window the game listens to. */
function pressKey(code: string): void {
  window.dispatchEvent(Object.assign(new Event("keydown"), { code }));
}

beforeEach(() => {
  time = 1000;
  nextFrameId = 1;
  pendingFrames.clear();
  vi.stubGlobal("HTMLCanvasElement", FakeCanvasElement);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("performance", { now: () => time });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    pendingFrames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pendingFrames.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Game loop", () => {
  it("runs scene systems with the fixed step and render systems once per frame", () => {
    const game = makeGame();
    const updateDts: number[] = [];
    let renders = 0;
    startWith(game, (scene) => {
      scene.addSystem((_world, dt) => updateDts.push(dt));
      scene.addRenderSystem(() => renders++);
    });
    tick(20);
    expect(updateDts).toEqual([FIXED_STEP]);
    expect(renders).toBe(1);
  });

  it("render systems never get a negative dt (first frame stamped before start)", () => {
    const game = makeGame();
    const renderDts: number[] = [];
    startWith(game, (scene) => scene.addRenderSystem((_world, dt) => renderDts.push(dt)));
    tick(-5);
    expect(renderDts).toEqual([0]);
  });

  it("stop() from inside a system ends the loop after the current frame", () => {
    const game = makeGame();
    startWith(game, (scene) => scene.addSystem(() => game.stop()));
    tick(20);
    expect(pendingFrames.size).toBe(0);
  });

  it("restarting from inside a system leaves exactly one loop running", () => {
    const game = makeGame();
    let restarted = false;
    let renders = 0;
    startWith(game, (scene) => {
      scene.addSystem(() => {
        if (restarted) return;
        restarted = true;
        game.stop();
        game.start("main");
      });
      scene.addRenderSystem(() => renders++);
    });
    tick(20);
    expect(pendingFrames.size).toBe(1);

    renders = 0;
    tick(16);
    tick(16);
    expect(renders).toBe(2);

    game.stop();
    expect(pendingFrames.size).toBe(0);
  });

  it("wasPressed survives a frame with zero update steps", () => {
    const game = makeGame();
    const seen: boolean[] = [];
    startWith(game, (scene) =>
      scene.addSystem((world) => seen.push(world.getResource(Keyboard).wasPressed("Space"))),
    );
    pressKey("Space");
    tick(5); // less than one step: no update runs
    expect(seen).toEqual([]);
    tick(20);
    tick(20);
    expect(seen).toEqual([true, false]);
  });
});

describe("Game setup", () => {
  it("game.world throws before a scene is running", () => {
    expect(() => makeGame().world).toThrow("No scene is running");
  });

  it("puts the built-in global resources in the scene's world", () => {
    const game = makeGame();
    startWith(game, () => {});
    expect(game.world.getResource(Assets)).toBe(game.assets);
    expect(game.world.getResource(Canvas)).toBe(game.canvas);
    expect(game.world.getResource(Keyboard)).toBeInstanceOf(Keyboard);
    expect(game.world.getResource(Scenes).current).toBe("main");
  });

  it("keeps image smoothing on by default", () => {
    expect(makeGame().canvas.ctx.imageSmoothingEnabled).toBe(true);
  });

  it("pixelArt turns image smoothing off", () => {
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    const game = new Game({ canvas, width: 100, height: 100, pixelArt: true });
    expect(game.canvas.ctx.imageSmoothingEnabled).toBe(false);
  });
});

describe("Scenes", () => {
  it("start runs the scene's setup once, with the world the game then exposes", () => {
    const game = makeGame();
    const worlds: World[] = [];
    startWith(game, (scene) => worlds.push(scene.world));
    expect(worlds).toHaveLength(1);
    expect(game.world).toBe(worlds[0]);
  });

  it("rejects a scene name that is already added", () => {
    const game = makeGame();
    game.addScene("main", { setup() {} });
    expect(() => game.addScene("main", { setup() {} })).toThrow(
      'Scene "main" is already added',
    );
  });

  it("start with an unknown scene throws and does not start the loop", () => {
    const game = makeGame();
    expect(() => game.start("nope")).toThrow('Scene "nope" not found');
    expect(pendingFrames.size).toBe(0);
  });

  it("switchTo throws right away for an unknown scene", () => {
    const game = makeGame();
    startWith(game, () => {});
    expect(() => game.world.getResource(Scenes).switchTo("nope")).toThrow(
      'Scene "nope" not found',
    );
  });

  it("global resources are the same object in every scene", () => {
    class Score {
      value = 0;
    }
    const game = makeGame();
    const score = new Score();
    game.addGlobalResource(score);
    const seen: Score[] = [];
    game.addScene("b", { setup: (scene) => seen.push(scene.world.getResource(Score)) });
    startWith(game, (scene) => {
      seen.push(scene.world.getResource(Score));
      scene.addSystem((world) => world.getResource(Scenes).switchTo("b"));
    });
    tick(20);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(score);
    expect(seen[1]).toBe(score);
  });

  it("addGlobalResource while a scene is running adds it to the current world too", () => {
    class Late {}
    const game = makeGame();
    startWith(game, () => {});
    const late = new Late();
    game.addGlobalResource(late);
    expect(game.world.getResource(Late)).toBe(late);
  });

  it("switches at the end of the step, after the rest of the old scene's systems", () => {
    const game = makeGame();
    const log: string[] = [];
    game.addScene("b", { setup: (scene) => scene.addSystem(() => log.push("b")) });
    startWith(game, (scene) => {
      scene.addSystem((world) => {
        log.push("a1");
        world.getResource(Scenes).switchTo("b");
      });
      scene.addSystem(() => log.push("a2"));
    });
    tick(20);
    expect(log).toEqual(["a1", "a2"]);
    expect(game.world.getResource(Scenes).current).toBe("b");
    tick(17);
    expect(log).toEqual(["a1", "a2", "b"]);
  });

  it("runs the steps left in the frame on the new scene", () => {
    const game = makeGame();
    const log: string[] = [];
    game.addScene("b", { setup: (scene) => scene.addSystem(() => log.push("b")) });
    startWith(game, (scene) =>
      scene.addSystem((world) => {
        log.push("a");
        world.getResource(Scenes).switchTo("b");
      }),
    );
    tick(40); // two fixed steps in one frame
    expect(log).toEqual(["a", "b"]);
  });

  it("renders the new scene in the frame that switched", () => {
    const game = makeGame();
    const renders: string[] = [];
    game.addScene("b", { setup: (scene) => scene.addRenderSystem(() => renders.push("b")) });
    startWith(game, (scene) => {
      scene.addSystem((world) => world.getResource(Scenes).switchTo("b"));
      scene.addRenderSystem(() => renders.push("a"));
    });
    tick(20);
    expect(renders).toEqual(["b"]);
  });

  it("the last switch requested in a step wins", () => {
    const game = makeGame();
    const setups: string[] = [];
    game.addScene("b", { setup: () => setups.push("b") });
    game.addScene("c", { setup: () => setups.push("c") });
    startWith(game, (scene) =>
      scene.addSystem((world) => {
        world.getResource(Scenes).switchTo("b");
        world.getResource(Scenes).switchTo("c");
      }),
    );
    tick(20);
    expect(setups).toEqual(["c"]);
    expect(game.world.getResource(Scenes).current).toBe("c");
  });

  it("switching to the running scene restarts it with a fresh world", () => {
    const game = makeGame();
    const worlds: World[] = [];
    let switched = false;
    startWith(game, (scene) => {
      worlds.push(scene.world);
      scene.addSystem((world) => {
        if (switched) return;
        switched = true;
        world.getResource(Scenes).switchTo("main");
      });
    });
    tick(20);
    expect(worlds).toHaveLength(2);
    expect(worlds[1]).not.toBe(worlds[0]);
    expect(game.world).toBe(worlds[1]);
  });

  it("a key pressed on the switching step is not seen by the new scene", () => {
    const game = makeGame();
    const seen: boolean[] = [];
    game.addScene("b", {
      setup: (scene) =>
        scene.addSystem((world) => seen.push(world.getResource(Keyboard).wasPressed("Enter"))),
    });
    startWith(game, (scene) =>
      scene.addSystem((world) => {
        if (world.getResource(Keyboard).wasPressed("Enter")) {
          world.getResource(Scenes).switchTo("b");
        }
      }),
    );
    pressKey("Enter");
    tick(20);
    tick(17);
    expect(seen).toEqual([false]);
  });
});

describe("Game animation", () => {
  it("animates sprites after the scene's own systems in each fixed step", async () => {
    const game = makeGame();
    const assets = new Assets(async () => ({ width: 64, height: 16 }) as HTMLImageElement);
    await assets.loadImages({
      hero: {
        url: "/hero.png",
        frameWidth: 16,
        frameHeight: 16,
        animations: { idle: { frames: [0], fps: 1 }, walk: { frames: [2, 3], fps: 8 } },
      },
    });
    // No Transform, so the renderer (whose fake context cannot draw images) skips it.
    const sprite = new Sprite("hero");
    const animator = new Animator("idle");
    startWith(game, (scene) => {
      // Replaces this world's Assets with one that loads fake images (game.assets keeps the old one).
      scene.world.setResource(assets);
      const entity = scene.world.spawn();
      scene.world.add(entity, sprite);
      scene.world.add(entity, animator);
      scene.addSystem(() => animator.play("walk"));
    });
    tick(20); // one fixed step
    expect(sprite.frame).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/engine/game.test.ts`
Expected: FAIL — `../../src/engine/scene/scene` cannot be resolved.

- [ ] **Step 3: Add the `Scenes` resource and scene types**

Create `src/engine/scene/scene.ts`:

```ts
import type { System, World } from "../ecs/world";

/** One part of a game (title screen, level...). `setup` fills its fresh World. */
export interface Scene {
  setup(scene: SceneContext): void;
}

/** What a scene's setup gets: its own World and a place for its systems. */
export interface SceneContext {
  readonly world: World;
  /** Adds a system that runs at a fixed 60 Hz while this scene runs, in the order added. */
  addSystem(system: System): void;
  /** Adds a system that runs once per browser frame, after the built-in renderer. */
  addRenderSystem(system: System): void;
}

/** Lets systems switch scenes. A global resource, present in every scene's World. */
export class Scenes {
  private currentName = "";
  private requested: string | null = null;

  constructor(private readonly exists: (name: string) => boolean) {}

  /** The name of the running scene. */
  get current(): string {
    return this.currentName;
  }

  /** Switches to another scene (or restarts this one) at the end of the current step. */
  switchTo(name: string): void {
    if (!this.exists(name)) throw new Error(`Scene "${name}" not found`);
    this.requested = name;
  }

  /** Called by Game when a scene starts. Drops any request made before it. */
  enter(name: string): void {
    this.currentName = name;
    this.requested = null;
  }

  /** Called by Game at the end of each step: the requested scene, if any. */
  takeRequest(): string | null {
    const name = this.requested;
    this.requested = null;
    return name;
  }
}
```

- [ ] **Step 4: Rewrite `Game`**

Replace `src/engine/core/game.ts` with:

```ts
import { animate } from "../animation/animate";
import { Assets } from "../assets/assets";
import { World, type System } from "../ecs/world";
import { Keyboard } from "../input/keyboard";
import { Canvas } from "../render/canvas";
import { render } from "../render/systems";
import { Scenes, type Scene } from "../scene/scene";
import { advance, FIXED_STEP } from "./timestep";

export interface GameOptions {
  /** A CSS selector like "#game", or the canvas element itself. */
  canvas: string | HTMLCanvasElement;
  width: number;
  height: number;
  /** Turn off image smoothing so scaled-up pixel art stays sharp. */
  pixelArt?: boolean;
}

/** The running scene: its world and its systems. */
interface ActiveScene {
  world: World;
  updateSystems: System[];
  renderSystems: System[];
}

export class Game {
  readonly assets = new Assets();
  readonly canvas: Canvas;
  private readonly keyboard = new Keyboard();
  private readonly sceneList = new Map<string, Scene>();
  private readonly scenes = new Scenes((name) => this.sceneList.has(name));
  /** Added to every scene's World; the same objects each time. */
  private readonly globalResources: object[];
  private active: ActiveScene | null = null;
  private running = false;
  private frameId = 0;
  private lastTime = 0;
  private accumulator = 0;

  constructor(options: GameOptions) {
    const element =
      typeof options.canvas === "string"
        ? document.querySelector(options.canvas)
        : options.canvas;
    if (!(element instanceof HTMLCanvasElement)) {
      throw new Error(`Canvas element not found: ${String(options.canvas)}`);
    }
    this.canvas = new Canvas(element, options.width, options.height);
    this.canvas.ctx.imageSmoothingEnabled = !options.pixelArt;
    this.globalResources = [this.canvas, this.assets, this.keyboard, this.scenes];
  }

  /** The running scene's World. */
  get world(): World {
    return this.scene.world;
  }

  addScene(name: string, scene: Scene): void {
    if (this.sceneList.has(name)) throw new Error(`Scene "${name}" is already added`);
    this.sceneList.set(name, scene);
  }

  /** Adds a resource to every scene's World (and to the running one, if any). */
  addGlobalResource(resource: object): void {
    this.globalResources.push(resource);
    this.active?.world.setResource(resource);
  }

  /** Starts the loop with a fresh instance of the named scene. */
  start(sceneName: string): void {
    if (this.running) return;
    this.enterScene(sceneName);
    this.running = true;
    this.keyboard.attach(window);
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.keyboard.detach();
  }

  private get scene(): ActiveScene {
    if (!this.active) throw new Error("No scene is running");
    return this.active;
  }

  /** Replaces the running scene with a fresh instance of the named one. */
  private enterScene(name: string): void {
    const scene = this.sceneList.get(name);
    if (!scene) throw new Error(`Scene "${name}" not found`);
    const world = new World();
    for (const resource of this.globalResources) world.setResource(resource);
    const active: ActiveScene = { world, updateSystems: [], renderSystems: [render] };
    this.active = active;
    this.scenes.enter(name);
    scene.setup({
      world,
      addSystem: (system) => {
        active.updateSystems.push(system);
      },
      addRenderSystem: (system) => {
        active.renderSystems.push(system);
      },
    });
  }

  private readonly frame = (now: number): void => {
    // Cleared so we can tell whether a system restarted the loop during this frame.
    this.frameId = 0;
    // The first frame's timestamp can be slightly earlier than start()'s performance.now().
    const elapsed = Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const { steps, accumulator } = advance(this.accumulator, elapsed);
    this.accumulator = accumulator;
    for (let i = 0; i < steps; i++) {
      const { world, updateSystems } = this.scene;
      for (const system of updateSystems) system(world, FIXED_STEP);
      // After the scene's systems, so a play() call shows its clip in the same step.
      animate(world, FIXED_STEP);
      this.keyboard.endStep();
      // Switching last means no system ever runs on a world that was just dropped.
      const next = this.scenes.takeRequest();
      if (next !== null) this.enterScene(next);
    }
    const { world, renderSystems } = this.scene;
    for (const system of renderSystems) system(world, elapsed);

    // A system may have called stop() (and maybe start(), which already scheduled a frame).
    if (this.running && this.frameId === 0) this.frameId = requestAnimationFrame(this.frame);
  };
}
```

In `src/engine/index.ts`, add after the `Game` lines:

```ts
export { Scenes } from "./scene/scene";
export type { Scene, SceneContext } from "./scene/scene";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/engine/game.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Move the demo into a play scene**

The demo still calls the removed `game.addSystem`, so typecheck fails until it uses a scene.

Create `src/game/scenes/play.ts`:

```ts
import { Animator, Canvas, Layer, Rect, Sprite, Transform, type Scene } from "../../engine";
import { Player, Velocity } from "../components";
import { bounce, clampPlayer, movement, playerAppearance, playerInput } from "../systems";

const PLAYER_SIZE = 32;

/** The hero walking around among bouncing rects. */
export const playScene: Scene = {
  setup(scene) {
    const { world } = scene;
    const { width, height } = world.getResource(Canvas);

    const background = world.spawn();
    world.add(background, new Transform(0, 0));
    world.add(background, new Sprite("background"));
    world.add(background, new Layer(-1));

    const player = world.spawn();
    world.add(player, new Player());
    world.add(player, new Transform((width - PLAYER_SIZE) / 2, (height - PLAYER_SIZE) / 2));
    world.add(player, new Sprite("hero", { width: PLAYER_SIZE, height: PLAYER_SIZE }));
    world.add(player, new Layer(1));
    world.add(player, new Velocity());
    world.add(player, new Animator("idle"));

    for (let i = 0; i < 10; i++) {
      const size = 12 + Math.random() * 24;
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 160;
      const e = world.spawn();
      world.add(e, new Transform(Math.random() * (width - size), Math.random() * (height - size)));
      world.add(e, new Rect(size, size, `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`));
      world.add(e, new Velocity(Math.cos(angle) * speed, Math.sin(angle) * speed));
    }

    scene.addSystem(playerInput);
    scene.addSystem(movement);
    scene.addSystem(bounce);
    scene.addSystem(clampPlayer);
    scene.addSystem(playerAppearance);
  },
};
```

Replace `src/game/main.ts` with:

```ts
import { Game } from "../engine";
import { drawError } from "./errors";
import { playScene } from "./scenes/play";

const game = new Game({ canvas: "#game", width: 800, height: 600, pixelArt: true });

try {
  await game.assets.loadImages({
    background: "/background.svg",
    hero: {
      url: "/hero.svg",
      frameWidth: 16,
      frameHeight: 16,
      animations: {
        idle: { frames: [0, 1], fps: 2 },
        walk: { frames: [2, 3, 4, 5], fps: 8 },
      },
    },
  });
} catch (error) {
  drawError(game.canvas, error);
  throw error;
}

game.addScene("play", playScene);
game.start("play");
```

- [ ] **Step 7: Verify the whole project**

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/engine/scene src/engine/core/game.ts src/engine/index.ts src/game/scenes/play.ts src/game/main.ts tests/engine/game.test.ts
git commit -m "feat: scenes with fresh worlds, global resources and deferred switching"
```

---

### Task 3: Demo — title scene, play counter, back to title

**Files:**
- Create: `src/game/resources.ts`
- Create: `src/game/scenes/title.ts`
- Modify: `src/game/scenes/play.ts`
- Modify: `src/game/main.ts`
- Test: `tests/game/scenes.test.ts`

**Interfaces:**
- Consumes: `Scenes` (`switchTo`, `takeRequest`), `Scene`, `SceneContext`, `Text`, `Keyboard`, `Canvas` from `src/engine/index.ts` (Tasks 1–2); `playScene` (Task 2).
- Produces:
  - `export class Plays { count = 0 }` in `src/game/resources.ts`
  - `export function startOnEnter(world: World): void` and `export const titleScene: Scene` in `src/game/scenes/title.ts`
  - `export function backToTitle(world: World): void` in `src/game/scenes/play.ts`; `playScene.setup` increments `Plays.count`, adds the hint text and registers `backToTitle`.

- [ ] **Step 1: Write the failing tests**

Create `tests/game/scenes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Keyboard, Scenes, Text, World, type Scene, type System } from "../../src/engine";
import { Plays } from "../../src/game/resources";
import { backToTitle, playScene } from "../../src/game/scenes/play";
import { startOnEnter, titleScene } from "../../src/game/scenes/title";
import { recordingCanvas } from "../helpers/recording-canvas";

/** A world with the resources the demo scenes use, as Game would provide them. */
function sceneWorld(plays = new Plays()) {
  const world = new World();
  const keyboard = new Keyboard();
  const scenes = new Scenes(() => true);
  world.setResource(recordingCanvas(800, 600).canvas);
  world.setResource(keyboard);
  world.setResource(scenes);
  world.setResource(plays);
  return { world, keyboard, scenes, plays };
}

/** Runs a scene's setup the way Game does; returns the systems it added. */
function runSetup(scene: Scene, world: World): System[] {
  const systems: System[] = [];
  scene.setup({
    world,
    addSystem: (system) => {
      systems.push(system);
    },
    addRenderSystem: () => {},
  });
  return systems;
}

function texts(world: World): string[] {
  return world.query(Text).map(([, text]) => text.value);
}

describe("startOnEnter", () => {
  it("switches to the play scene when Enter is pressed", () => {
    const { world, keyboard, scenes } = sceneWorld();
    keyboard.handleKeyDown("Enter");
    startOnEnter(world);
    expect(scenes.takeRequest()).toBe("play");
  });

  it("does nothing otherwise", () => {
    const { world, keyboard, scenes } = sceneWorld();
    keyboard.handleKeyDown("Space");
    startOnEnter(world);
    expect(scenes.takeRequest()).toBeNull();
  });
});

describe("backToTitle", () => {
  it("switches to the title scene when Escape is pressed", () => {
    const { world, keyboard, scenes } = sceneWorld();
    keyboard.handleKeyDown("Escape");
    backToTitle(world);
    expect(scenes.takeRequest()).toBe("title");
  });

  it("does nothing otherwise", () => {
    const { world, scenes } = sceneWorld();
    backToTitle(world);
    expect(scenes.takeRequest()).toBeNull();
  });
});

describe("titleScene", () => {
  it("shows the prompt and how many games were played, and listens for Enter", () => {
    const plays = new Plays();
    plays.count = 3;
    const { world } = sceneWorld(plays);
    const systems = runSetup(titleScene, world);
    expect(texts(world)).toEqual(["Press Enter to start", "Games played: 3"]);
    expect(systems).toContain(startOnEnter);
  });
});

describe("playScene", () => {
  it("counts the play, shows the hint, and listens for Escape", () => {
    const { world, plays } = sceneWorld();
    const systems = runSetup(playScene, world);
    expect(plays.count).toBe(1);
    expect(texts(world)).toEqual(["Esc: back to title"]);
    expect(systems).toContain(backToTitle);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/game/scenes.test.ts`
Expected: FAIL — `../../src/game/resources` cannot be resolved.

- [ ] **Step 3: Add the `Plays` resource**

Create `src/game/resources.ts`:

```ts
/** How many times the play scene has started. A global resource, so it survives scene switches. */
export class Plays {
  count = 0;
}
```

- [ ] **Step 4: Add the title scene**

Create `src/game/scenes/title.ts`:

```ts
import {
  Canvas,
  Keyboard,
  Layer,
  Scenes,
  Sprite,
  Text,
  Transform,
  type Scene,
  type World,
} from "../../engine";
import { Plays } from "../resources";

/** Starts the game when Enter is pressed. */
export function startOnEnter(world: World): void {
  if (world.getResource(Keyboard).wasPressed("Enter")) {
    world.getResource(Scenes).switchTo("play");
  }
}

/** The title screen: a prompt and the number of games played so far. */
export const titleScene: Scene = {
  setup(scene) {
    const { world } = scene;
    const { width, height } = world.getResource(Canvas);

    const background = world.spawn();
    world.add(background, new Transform(0, 0));
    world.add(background, new Sprite("background"));
    world.add(background, new Layer(-1));

    const prompt = world.spawn();
    world.add(prompt, new Transform(width / 2, height / 2 - 40));
    world.add(prompt, new Text("Press Enter to start", { size: 32, align: "center" }));

    const plays = world.spawn();
    world.add(plays, new Transform(width / 2, height / 2 + 10));
    world.add(
      plays,
      new Text(`Games played: ${world.getResource(Plays).count}`, {
        size: 20,
        color: "#cbd5e1",
        align: "center",
      }),
    );

    scene.addSystem(startOnEnter);
  },
};
```

- [ ] **Step 5: Extend the play scene**

In `src/game/scenes/play.ts`, change the engine import to:

```ts
import {
  Animator,
  Canvas,
  Keyboard,
  Layer,
  Rect,
  Scenes,
  Sprite,
  Text,
  Transform,
  type Scene,
  type World,
} from "../../engine";
```

and add after the `../systems` import:

```ts
import { Plays } from "../resources";
```

Add before `export const playScene`:

```ts
/** Returns to the title screen when Escape is pressed. */
export function backToTitle(world: World): void {
  if (world.getResource(Keyboard).wasPressed("Escape")) {
    world.getResource(Scenes).switchTo("title");
  }
}
```

In `playScene.setup`, add right after `const { width, height } = world.getResource(Canvas);`:

```ts
    world.getResource(Plays).count++;
```

add before `scene.addSystem(playerInput);`:

```ts
    const hint = world.spawn();
    world.add(hint, new Transform(12, 12));
    world.add(hint, new Text("Esc: back to title", { size: 14, color: "#cbd5e1" }));
    world.add(hint, new Layer(2));
```

and add after `scene.addSystem(playerAppearance);`:

```ts
    scene.addSystem(backToTitle);
```

- [ ] **Step 6: Register everything in `main.ts`**

In `src/game/main.ts`, add the imports:

```ts
import { Plays } from "./resources";
import { titleScene } from "./scenes/title";
```

and replace the last two lines (`game.addScene("play", playScene);` and `game.start("play");`) with:

```ts
game.addGlobalResource(new Plays());
game.addScene("title", titleScene);
game.addScene("play", playScene);
game.start("title");
```

- [ ] **Step 7: Verify the whole project**

Run: `npx vitest run tests/game/scenes.test.ts`
Expected: PASS, all tests.

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Check in the browser**

Start `npx vite --port 5173 --strictPort` in the background, call `tabs_context_mcp` (create the group if empty) and navigate a tab to `http://localhost:5173/`. The tab may be hidden, in which case frames only advance when a screenshot is taken: dispatch keys on `window` with `javascript_tool` (`new KeyboardEvent("keydown", { code })` then `keyup`), and take a screenshot after each key so a frame runs.

1. Screenshot. Expected: night background, "Press Enter to start" and "Games played: 0" centered, no hero or rects.
2. Press Enter, screenshot twice. Expected: the play scene (hero centered, bouncing rects, "Esc: back to title" at top left).
3. Hold ArrowRight for a few screenshots, release. Expected: the hero walks right.
4. Press Escape, screenshot twice. Expected: the title, now "Games played: 1".
5. Press Enter, screenshot twice. Expected: a fresh play scene, hero back in the center.

Then close the tab, stop the dev server (kill the node process whose command line contains `vite` via PowerShell `Get-CimInstance Win32_Process`) and confirm port 5173 is free.

- [ ] **Step 9: Commit**

```bash
git add src/game tests/game/scenes.test.ts
git commit -m "feat: title scene, play counter and back-to-title in the demo"
```
