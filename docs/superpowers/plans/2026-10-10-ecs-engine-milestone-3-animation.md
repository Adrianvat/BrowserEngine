# Milestone 3: Frame Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Named animation clips declared on sprite sheets, played on entities by an `Animator` component and a built-in fixed-step `animate` system.

**Architecture:** `Assets` stores validated clips per sheet. `Animator` (component) holds the playing clip name, elapsed time and a `finished` flag. `animate` (system) turns elapsed time into `sprite.frame`. `Game` runs `animate` after the game's own update systems in every fixed step. The renderer is unchanged.

**Tech Stack:** TypeScript 7 (strict), Vite 8, Vitest 5 (Node environment, no DOM), no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-10-ecs-engine-milestone-3-animation-design.md`

## Global Constraints

- TypeScript only, strict; no runtime dependencies; Canvas 2D.
- Game code (`src/game/`) imports only from `src/engine/index.ts`.
- The renderer (`src/engine/render/systems.ts`) does not change.
- Error messages exactly as the spec writes them:
  - `Animation "<name>" of image "<image>" has no frames`
  - `Animation "<name>" of image "<image>" has invalid fps (<fps>)`
  - `Animation "<name>" of image "<image>": frame <f> is out of range (<n> frames)` (`(1 frame)` when the sheet has one frame)
  - `Animation "<name>" not found for image "<image>"`
- `loop` defaults to `true`. Clip checks reject the whole `loadImages` batch.
- `animate` is not exported from `src/engine/index.ts`; `Animator` and the type `AnimationClip` are.
- Verification commands: `npm test`, `npm run typecheck`, `npm run build`.

## Review Focus

- Float rounding at the 60 Hz step: fps 10 after six `FIXED_STEP`s must show the second frame, not the first (Task 2 test).
- A step longer than a whole loop cycle must still land on the right frame and keep `time` below one cycle (Task 2 test).
- Mutating the object passed to `loadImages` after loading must not change the stored clips (Task 1 test).
- Reloading a sheet name with different clips must drop the old clips (Task 1 test).
- A `play()` in a game system must show the new clip's first frame in the same step, not one step later (Task 3 test).

## File Structure

```
src/engine/assets/assets.ts          modify: AnimationClip, SheetSource.animations, clip checks, getAnimation, hasAnimation
src/engine/animation/animator.ts     create: Animator component
src/engine/animation/animate.ts      create: animate system
src/engine/core/game.ts              modify: run animate after update systems
src/engine/index.ts                  modify: export Animator, type AnimationClip
src/game/systems.ts                  modify: playerAppearance plays clips
src/game/main.ts                     modify: declare clips, add Animator
public/hero.svg                      replace: 96x16, six frames
tests/engine/assets.test.ts          modify
tests/engine/animation.test.ts       create
tests/engine/game.test.ts            modify
tests/game/systems.test.ts           modify
```

---

### Task 1: Animation clips in `Assets`

**Files:**
- Modify: `src/engine/assets/assets.ts`
- Test: `tests/engine/assets.test.ts`

**Interfaces:**
- Consumes: existing `Assets`, `SheetSource`, `ImageLoader`.
- Produces:
  - `export interface AnimationClip { frames: number[]; fps: number; loop?: boolean }`
  - `SheetSource.animations?: Record<string, AnimationClip>`
  - `Assets.getAnimation(image: string, name: string): Required<AnimationClip>` (a narrowing of the spec's `AnimationClip`; `loop` always set)
  - `Assets.hasAnimation(image: string, name: string): boolean`

- [ ] **Step 1: Write the failing tests**

Change the first import line of `tests/engine/assets.test.ts` to:

```ts
import { Assets, type AnimationClip, type ImageLoader } from "../../src/engine/assets/assets";
```

Append to the end of the file:

```ts
describe("Assets animations", () => {
  function makeAssets() {
    return new Assets(
      fakeLoader({ "/hero.png": fakeImage(64, 32), "/bg.png": fakeImage(50, 40) }),
    );
  }

  /** An 8-frame hero sheet (4 columns x 2 rows of 16x16) with the given clips. */
  function heroSheet(animations: Record<string, AnimationClip>) {
    return { url: "/hero.png", frameWidth: 16, frameHeight: 16, animations };
  }

  it("returns declared clips, with loop defaulting to true", async () => {
    const assets = makeAssets();
    await assets.loadImages({
      hero: heroSheet({
        walk: { frames: [2, 3], fps: 8 },
        die: { frames: [7], fps: 4, loop: false },
      }),
    });
    expect(assets.getAnimation("hero", "walk")).toEqual({ frames: [2, 3], fps: 8, loop: true });
    expect(assets.getAnimation("hero", "die")).toEqual({ frames: [7], fps: 4, loop: false });
  });

  it("hasAnimation is true only for a declared clip of a loaded sheet", async () => {
    const assets = makeAssets();
    await assets.loadImages({ hero: heroSheet({ walk: { frames: [0], fps: 1 } }), bg: "/bg.png" });
    expect(assets.hasAnimation("hero", "walk")).toBe(true);
    expect(assets.hasAnimation("hero", "jump")).toBe(false);
    expect(assets.hasAnimation("bg", "walk")).toBe(false);
    expect(assets.hasAnimation("nope", "walk")).toBe(false);
  });

  it("getAnimation throws for an unknown image or clip", async () => {
    const assets = makeAssets();
    await assets.loadImages({ hero: heroSheet({ walk: { frames: [0], fps: 1 } }) });
    expect(() => assets.getAnimation("nope", "walk")).toThrow('Image "nope" is not loaded');
    expect(() => assets.getAnimation("hero", "jump")).toThrow(
      'Animation "jump" not found for image "hero"',
    );
  });

  it("copies clips at load, so later changes to the source have no effect", async () => {
    const assets = makeAssets();
    const walk = { frames: [2, 3], fps: 8 };
    await assets.loadImages({ hero: heroSheet({ walk }) });
    walk.frames.push(99);
    walk.fps = 0;
    expect(assets.getAnimation("hero", "walk")).toEqual({ frames: [2, 3], fps: 8, loop: true });
  });

  it("reloading a sheet replaces its clips", async () => {
    const assets = makeAssets();
    await assets.loadImages({ hero: heroSheet({ walk: { frames: [0], fps: 1 } }) });
    await assets.loadImages({ hero: heroSheet({ run: { frames: [1], fps: 1 } }) });
    expect(assets.hasAnimation("hero", "walk")).toBe(false);
    expect(assets.hasAnimation("hero", "run")).toBe(true);
  });

  it("rejects a clip with no frames, keeping none of the batch", async () => {
    const assets = makeAssets();
    await expect(
      assets.loadImages({ bg: "/bg.png", hero: heroSheet({ walk: { frames: [], fps: 8 } }) }),
    ).rejects.toThrow('Animation "walk" of image "hero" has no frames');
    expect(assets.hasImage("bg")).toBe(false);
    expect(assets.hasImage("hero")).toBe(false);
  });

  it.each([0, -1, NaN, Infinity])("rejects fps %s", async (fps) => {
    const assets = makeAssets();
    await expect(
      assets.loadImages({ hero: heroSheet({ walk: { frames: [0], fps } }) }),
    ).rejects.toThrow(`Animation "walk" of image "hero" has invalid fps (${fps})`);
  });

  it.each([8, -1, 1.5])("rejects frame %s, which is not in the sheet", async (frame) => {
    const assets = makeAssets();
    await expect(
      assets.loadImages({ hero: heroSheet({ walk: { frames: [0, frame], fps: 8 } }) }),
    ).rejects.toThrow(`Animation "walk" of image "hero": frame ${frame} is out of range (8 frames)`);
  });

  it("says (1 frame) for a one-frame sheet", async () => {
    const assets = new Assets(fakeLoader({ "/one.png": fakeImage(16, 16) }));
    await expect(
      assets.loadImages({
        one: { url: "/one.png", frameWidth: 16, frameHeight: 16, animations: { a: { frames: [1], fps: 1 } } },
      }),
    ).rejects.toThrow('Animation "a" of image "one": frame 1 is out of range (1 frame)');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/engine/assets.test.ts`
Expected: FAIL — the new tests fail (`getAnimation`/`hasAnimation` is not a function, and the reject tests resolve instead of rejecting); the existing tests still pass.

- [ ] **Step 3: Implement**

In `src/engine/assets/assets.ts`:

Replace the `SheetSource` interface with:

```ts
/** A named sequence of sheet frames played at a fixed speed. */
export interface AnimationClip {
  /** Sheet frame indices, in playback order. */
  frames: number[];
  /** Frames per second. */
  fps: number;
  /** Start again after the last frame (default true); otherwise stop on it. */
  loop?: boolean;
}

/** An image split into a grid of equal-size frames. */
export interface SheetSource {
  url: string;
  frameWidth: number;
  frameHeight: number;
  /** Named clips that play frames of this sheet. */
  animations?: Record<string, AnimationClip>;
}
```

Replace the `LoadedImage` interface with:

```ts
interface LoadedImage {
  image: HTMLImageElement;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  count: number;
  animations: Map<string, Required<AnimationClip>>;
}
```

Add after `isPositiveInteger`:

```ts
function frameCountText(count: number): string {
  return count === 1 ? "1 frame" : `${count} frames`;
}

/** Checks a sheet's clips against its frame count and copies them, filling in defaults. */
function checkAnimations(
  image: string,
  count: number,
  animations: Record<string, AnimationClip>,
): Map<string, Required<AnimationClip>> {
  const checked = new Map<string, Required<AnimationClip>>();
  for (const [name, clip] of Object.entries(animations)) {
    const label = `Animation "${name}" of image "${image}"`;
    if (clip.frames.length === 0) throw new Error(`${label} has no frames`);
    if (!(Number.isFinite(clip.fps) && clip.fps > 0)) {
      throw new Error(`${label} has invalid fps (${clip.fps})`);
    }
    for (const frame of clip.frames) {
      if (!Number.isInteger(frame) || frame < 0 || frame >= count) {
        throw new Error(`${label}: frame ${frame} is out of range (${frameCountText(count)})`);
      }
    }
    checked.set(name, { frames: [...clip.frames], fps: clip.fps, loop: clip.loop ?? true });
  }
  return checked;
}
```

In `getFrame`, replace the two lines building the error with:

```ts
      throw new Error(`Frame ${index} is out of range for "${name}" (${frameCountText(count)})`);
```

Add after `getFrame`:

```ts
  /** A clip declared on a sheet; `loop` is always filled in. */
  getAnimation(image: string, name: string): Required<AnimationClip> {
    const clip = this.entry(image).animations.get(name);
    if (!clip) throw new Error(`Animation "${name}" not found for image "${image}"`);
    return clip;
  }

  hasAnimation(image: string, name: string): boolean {
    return this.images.get(image)?.animations.has(name) ?? false;
  }
```

In `loadOne`, change the single-image return to:

```ts
      return {
        image,
        frameWidth: width,
        frameHeight: height,
        columns: 1,
        count: 1,
        animations: new Map(),
      };
```

and the sheet return to:

```ts
    const count = columns * rows;
    const animations = checkAnimations(name, count, source.animations ?? {});
    return { image, frameWidth, frameHeight, columns, count, animations };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/engine/assets.test.ts`
Expected: PASS, all tests.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/engine/assets/assets.ts tests/engine/assets.test.ts
git commit -m "feat: named animation clips on sprite sheets"
```

---

### Task 2: `Animator` component and `animate` system

**Files:**
- Create: `src/engine/animation/animator.ts`
- Create: `src/engine/animation/animate.ts`
- Test: `tests/engine/animation.test.ts`

**Interfaces:**
- Consumes: `Assets.getAnimation(image, name): Required<AnimationClip>` (Task 1), `Sprite` (`image`, `frame`), `World.query`, `World.getResource`, `FIXED_STEP`.
- Produces:
  - `export class Animator { clip: string; time: number; finished: boolean; constructor(clip: string); play(clip: string): void; restart(): void }`
  - `export function animate(world: World, dt: number): void`

- [ ] **Step 1: Write the failing tests**

Create `tests/engine/animation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { animate } from "../../src/engine/animation/animate";
import { Animator } from "../../src/engine/animation/animator";
import { Assets } from "../../src/engine/assets/assets";
import { FIXED_STEP } from "../../src/engine/core/timestep";
import { World } from "../../src/engine/ecs/world";
import { Sprite } from "../../src/engine/render/components";

/** A world with an 8-frame "hero" sheet and a 4-frame "ghost" sheet. */
async function setup() {
  const world = new World();
  const assets = new Assets(async (url) =>
    (url === "/hero.png" ? { width: 64, height: 32 } : { width: 64, height: 16 }) as HTMLImageElement,
  );
  await assets.loadImages({
    hero: {
      url: "/hero.png",
      frameWidth: 16,
      frameHeight: 16,
      animations: {
        idle: { frames: [0, 1], fps: 2 },
        walk: { frames: [2, 3, 4], fps: 4 },
        attack: { frames: [5, 6, 7], fps: 4, loop: false },
        tenth: { frames: [0, 1, 2, 3, 4, 5, 6, 7], fps: 10 },
      },
    },
    ghost: {
      url: "/ghost.png",
      frameWidth: 16,
      frameHeight: 16,
      animations: { walk: { frames: [3], fps: 1 } },
    },
  });
  world.setResource(assets);

  const sprite = new Sprite("hero");
  const animator = new Animator("walk");
  const entity = world.spawn();
  world.add(entity, sprite);
  world.add(entity, animator);

  /** Runs animate `count` times with the given dt; returns sprite.frame after each. */
  const run = (count: number, dt: number) => {
    const frames: number[] = [];
    for (let i = 0; i < count; i++) {
      animate(world, dt);
      frames.push(sprite.frame);
    }
    return frames;
  };
  return { world, sprite, animator, run };
}

describe("Animator", () => {
  it("starts at the beginning of its clip", () => {
    const animator = new Animator("walk");
    expect([animator.clip, animator.time, animator.finished]).toEqual(["walk", 0, false]);
  });

  it("play switches clips and starts the new one from the beginning", () => {
    const animator = new Animator("attack");
    animator.time = 1.5;
    animator.finished = true;
    animator.play("idle");
    expect([animator.clip, animator.time, animator.finished]).toEqual(["idle", 0, false]);
  });

  it("play does nothing when the clip is already playing", () => {
    const animator = new Animator("walk");
    animator.time = 0.3;
    animator.play("walk");
    expect(animator.time).toBe(0.3);
  });

  it("restart plays the current clip again from the beginning", () => {
    const animator = new Animator("attack");
    animator.time = 2;
    animator.finished = true;
    animator.restart();
    expect([animator.clip, animator.time, animator.finished]).toEqual(["attack", 0, false]);
  });
});

describe("animate", () => {
  it("shows the clip's frames at its fps, starting with the first", async () => {
    const { run } = await setup();
    // walk = [2, 3, 4] at 4 fps: each frame lasts 0.25 s.
    expect(run(4, 0.125)).toEqual([2, 3, 3, 4]);
  });

  it("loops back to the first frame and keeps time within one cycle", async () => {
    const { animator, run } = await setup();
    expect(run(4, 0.25)).toEqual([3, 4, 2, 3]);
    expect(animator.time).toBeCloseTo(0.25);
    expect(animator.finished).toBe(false);
  });

  it("handles a step longer than a whole cycle", async () => {
    const { animator, run } = await setup();
    // 2 s at 4 fps = position 8 = two whole cycles of 3, plus 2.
    expect(run(1, 2)).toEqual([4]);
    expect(animator.time).toBeCloseTo(0.5);
  });

  it("holds the last frame of a one-shot clip and sets finished", async () => {
    const { animator, run } = await setup();
    animator.play("attack");
    expect(run(2, 0.25)).toEqual([6, 7]);
    expect(animator.finished).toBe(false);
    expect(run(2, 0.25)).toEqual([7, 7]);
    expect(animator.finished).toBe(true);
  });

  it("lands exactly on frame boundaries at the 60 Hz step", async () => {
    const { animator, run } = await setup();
    animator.play("tenth");
    // At 10 fps each frame lasts exactly 6 fixed steps.
    const frames = run(12, FIXED_STEP);
    expect(frames.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(frames.slice(5, 11)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(frames[11]).toBe(2);
  });

  it("uses the clip of the sprite's current image", async () => {
    const { sprite, run } = await setup();
    sprite.image = "ghost";
    expect(run(1, 0.1)).toEqual([3]);
  });

  it("throws when the clip is not declared on the sprite's image", async () => {
    const { world, animator } = await setup();
    animator.play("jump");
    expect(() => animate(world, FIXED_STEP)).toThrow('Animation "jump" not found for image "hero"');
  });

  it("ignores an Animator without a Sprite", () => {
    const world = new World(); // no Assets resource either
    const animator = new Animator("walk");
    world.add(world.spawn(), animator);
    animate(world, FIXED_STEP);
    expect(animator.time).toBe(0);
  });
});
```

Note on the first `animate` test: 0.125 s → position 0 (frame 2), 0.25 s → 1 (3), 0.375 s → 1 (3), 0.5 s → 2 (4). In the loop test, 0.75 s is position 3, which wraps to 0 (frame 2) and `time` becomes 0; then 0.25 s → frame 3.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/engine/animation.test.ts`
Expected: FAIL — the files `src/engine/animation/animate` and `animator` cannot be resolved.

- [ ] **Step 3: Implement the component**

Create `src/engine/animation/animator.ts`:

```ts
/** Plays one of its sprite image's animation clips. */
export class Animator {
  /** Seconds since the clip started. */
  time = 0;
  /** True once a clip with `loop: false` has reached its end. */
  finished = false;

  constructor(public clip: string) {}

  /** Switches to another clip from its start. Does nothing if `clip` is already playing. */
  play(clip: string): void {
    if (clip === this.clip) return;
    this.clip = clip;
    this.restart();
  }

  /** Plays the current clip again from its start. */
  restart(): void {
    this.time = 0;
    this.finished = false;
  }
}
```

- [ ] **Step 4: Implement the system**

Create `src/engine/animation/animate.ts`:

```ts
import { Assets } from "../assets/assets";
import type { World } from "../ecs/world";
import { Sprite } from "../render/components";
import { Animator } from "./animator";

/** Keeps float rounding (e.g. six 1/60 s steps at 10 fps) from landing just short of a frame. */
const EPSILON = 1e-9;

/** Advances every Animator and sets its Sprite's frame. Runs once per fixed step. */
export function animate(world: World, dt: number): void {
  const rows = world.query(Sprite, Animator);
  if (rows.length === 0) return;
  const assets = world.getResource(Assets);

  for (const [, sprite, animator] of rows) {
    const clip = assets.getAnimation(sprite.image, animator.clip);
    const count = clip.frames.length;
    animator.time += dt;
    let position = Math.floor(animator.time * clip.fps + EPSILON);

    if (clip.loop) {
      const cycles = Math.floor(position / count);
      if (cycles > 0) {
        position -= cycles * count;
        animator.time = Math.max(0, animator.time - (cycles * count) / clip.fps);
      }
    } else if (position >= count) {
      position = count - 1;
      animator.finished = true;
    }

    sprite.frame = clip.frames[position];
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/engine/animation.test.ts`
Expected: PASS, all tests.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine/animation tests/engine/animation.test.ts
git commit -m "feat: Animator component and animate system"
```

---

### Task 3: Run `animate` in the game loop and export the API

**Files:**
- Modify: `src/engine/core/game.ts`
- Modify: `src/engine/index.ts`
- Test: `tests/engine/game.test.ts`

**Interfaces:**
- Consumes: `animate(world, dt)` and `Animator` (Task 2), `AnimationClip` (Task 1).
- Produces: `Animator` and `type AnimationClip` exported from `src/engine/index.ts`; `Game` runs `animate` after the game's update systems in every fixed step.

- [ ] **Step 1: Write the failing test**

In `tests/engine/game.test.ts`, add these imports after the existing ones:

```ts
import { Animator } from "../../src/engine/animation/animator";
import { Sprite } from "../../src/engine/render/components";
```

Append to the end of the file:

```ts
describe("Game animation", () => {
  it("animates sprites after the game's own systems in each fixed step", async () => {
    const game = makeGame();
    // Replaces the Assets resource with one that loads fake images (game.assets keeps the old one).
    const assets = new Assets(async () => ({ width: 64, height: 16 }) as HTMLImageElement);
    await assets.loadImages({
      hero: {
        url: "/hero.png",
        frameWidth: 16,
        frameHeight: 16,
        animations: { idle: { frames: [0], fps: 1 }, walk: { frames: [2, 3], fps: 8 } },
      },
    });
    game.world.setResource(assets);

    // No Transform, so the renderer (whose fake context cannot draw images) skips it.
    const sprite = new Sprite("hero");
    const animator = new Animator("idle");
    const entity = game.world.spawn();
    game.world.add(entity, sprite);
    game.world.add(entity, animator);
    game.addSystem(() => animator.play("walk"));
    game.start();
    tick(20); // one fixed step
    expect(sprite.frame).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/engine/game.test.ts`
Expected: FAIL — `expected 0 to be 2` (nothing animates yet).

- [ ] **Step 3: Implement**

In `src/engine/core/game.ts`, add the import:

```ts
import { animate } from "../animation/animate";
```

and change the update loop in `frame` to:

```ts
    for (let i = 0; i < steps; i++) {
      for (const system of this.updateSystems) system(this.world, FIXED_STEP);
      // After the game's systems, so a play() call shows its clip in the same step.
      animate(this.world, FIXED_STEP);
      this.keyboard.endStep();
    }
```

Update the `addSystem` doc comment to:

```ts
  /** Adds a system that runs at a fixed 60 Hz, in the order added, before the built-in animation. */
```

In `src/engine/index.ts`, change the assets type export and add the Animator export:

```ts
export type { AnimationClip, Frame, ImageLoader, ImageSource, SheetSource } from "./assets/assets";
export { Animator } from "./animation/animator";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/engine/core/game.ts src/engine/index.ts tests/engine/game.test.ts
git commit -m "feat: run animations in the fixed step and export Animator"
```

---

### Task 4: Demo — animated hero

**Files:**
- Modify: `src/game/systems.ts`
- Modify: `src/game/main.ts`
- Replace: `public/hero.svg`
- Test: `tests/game/systems.test.ts`

**Interfaces:**
- Consumes: `Animator`, `AnimationClip` from `src/engine/index.ts` (Task 3).
- Produces: `playerAppearance` that calls `animator.play("walk" | "idle")`; the hero sheet with clips `idle` (frames 0–1, 2 fps) and `walk` (frames 2–5, 8 fps).

- [ ] **Step 1: Update the tests**

In `tests/game/systems.test.ts`, change the engine import to:

```ts
import { Animator, Assets, Keyboard, Sprite, Transform, World } from "../../src/engine";
```

Replace the `playerAppearance` `setup` function and its first test with:

```ts
  function setup() {
    const world = new World();
    const player = world.spawn();
    const velocity = new Velocity();
    const sprite = new Sprite("hero");
    const animator = new Animator("idle");
    world.add(player, new Player());
    world.add(player, velocity);
    world.add(player, sprite);
    world.add(player, animator);
    return { world, velocity, sprite, animator };
  }

  it("plays walk while moving and idle when still", () => {
    const { world, velocity, animator } = setup();
    velocity.y = 10;
    playerAppearance(world);
    expect(animator.clip).toBe("walk");
    velocity.y = 0;
    playerAppearance(world);
    expect(animator.clip).toBe("idle");
  });

  it("keeps the walk going while the player keeps moving", () => {
    const { world, velocity, animator } = setup();
    velocity.x = 10;
    playerAppearance(world);
    animator.time = 0.3;
    playerAppearance(world);
    expect(animator.time).toBe(0.3);
  });
```

Leave the "faces the way it moves" test as it is.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/game/systems.test.ts`
Expected: FAIL — `expected 'idle' to be 'walk'` (playerAppearance still sets frames).

- [ ] **Step 3: Implement `playerAppearance`**

In `src/game/systems.ts`, change the engine import to:

```ts
import { Animator, Assets, Canvas, Keyboard, Rect, Sprite, Transform, type World } from "../engine";
```

Delete the `/** Frames in hero.svg. */` comment and the `STANDING_FRAME` / `MOVING_FRAME` constants, and replace `playerAppearance` with:

```ts
/** Picks the player's animation and facing from its velocity. */
export function playerAppearance(world: World): void {
  for (const [, , velocity, sprite, animator] of world.query(Player, Velocity, Sprite, Animator)) {
    const moving = velocity.x !== 0 || velocity.y !== 0;
    animator.play(moving ? "walk" : "idle");
    if (velocity.x < 0) sprite.flipX = true;
    else if (velocity.x > 0) sprite.flipX = false;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/game/systems.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Redraw the hero sheet**

Replace `public/hero.svg` with (six 16×16 frames facing right; the near leg is lighter than the far leg so the walk reads as alternating steps):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="16" viewBox="0 0 96 16" shape-rendering="crispEdges">
  <!-- Frame 0: idle, up -->
  <rect x="5" y="1" width="6" height="5" fill="#fcd34d" />
  <rect x="9" y="3" width="1" height="1" fill="#111827" />
  <rect x="4" y="6" width="8" height="5" fill="#22c55e" />
  <rect x="5" y="11" width="2" height="4" fill="#172554" />
  <rect x="9" y="11" width="2" height="4" fill="#1e3a8a" />
  <!-- Frame 1: idle, down 1px (legs stay planted) -->
  <g transform="translate(16 0)">
    <rect x="5" y="2" width="6" height="5" fill="#fcd34d" />
    <rect x="9" y="4" width="1" height="1" fill="#111827" />
    <rect x="4" y="7" width="8" height="4" fill="#22c55e" />
    <rect x="5" y="11" width="2" height="4" fill="#172554" />
    <rect x="9" y="11" width="2" height="4" fill="#1e3a8a" />
  </g>
  <!-- Frame 2: walk, near leg forward -->
  <g transform="translate(32 0)">
    <rect x="5" y="1" width="6" height="5" fill="#fcd34d" />
    <rect x="9" y="3" width="1" height="1" fill="#111827" />
    <rect x="4" y="6" width="8" height="5" fill="#22c55e" />
    <rect x="3" y="11" width="2" height="4" fill="#172554" />
    <rect x="10" y="11" width="2" height="4" fill="#1e3a8a" />
    <rect x="2" y="7" width="2" height="2" fill="#16a34a" />
  </g>
  <!-- Frame 3: walk, passing (near leg lifted) -->
  <g transform="translate(48 0)">
    <rect x="5" y="2" width="6" height="5" fill="#fcd34d" />
    <rect x="9" y="4" width="1" height="1" fill="#111827" />
    <rect x="4" y="7" width="8" height="4" fill="#22c55e" />
    <rect x="6" y="11" width="2" height="4" fill="#172554" />
    <rect x="8" y="11" width="2" height="3" fill="#1e3a8a" />
  </g>
  <!-- Frame 4: walk, far leg forward -->
  <g transform="translate(64 0)">
    <rect x="5" y="1" width="6" height="5" fill="#fcd34d" />
    <rect x="9" y="3" width="1" height="1" fill="#111827" />
    <rect x="4" y="6" width="8" height="5" fill="#22c55e" />
    <rect x="10" y="11" width="2" height="4" fill="#172554" />
    <rect x="3" y="11" width="2" height="4" fill="#1e3a8a" />
    <rect x="12" y="7" width="2" height="2" fill="#16a34a" />
  </g>
  <!-- Frame 5: walk, passing (far leg lifted) -->
  <g transform="translate(80 0)">
    <rect x="5" y="2" width="6" height="5" fill="#fcd34d" />
    <rect x="9" y="4" width="1" height="1" fill="#111827" />
    <rect x="4" y="7" width="8" height="4" fill="#22c55e" />
    <rect x="6" y="11" width="2" height="3" fill="#172554" />
    <rect x="8" y="11" width="2" height="4" fill="#1e3a8a" />
  </g>
</svg>
```

- [ ] **Step 6: Declare the clips and add the Animator in `main.ts`**

In `src/game/main.ts`, change the engine import to:

```ts
import { Animator, Canvas, Game, Layer, Rect, Sprite, Transform } from "../engine";
```

Change the hero entry in `loadImages` to:

```ts
    hero: {
      url: "/hero.svg",
      frameWidth: 16,
      frameHeight: 16,
      animations: {
        idle: { frames: [0, 1], fps: 2 },
        walk: { frames: [2, 3, 4, 5], fps: 8 },
      },
    },
```

Add after `world.add(player, new Velocity());`:

```ts
world.add(player, new Animator("idle"));
```

- [ ] **Step 7: Verify the whole project**

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Check in the browser**

Start `npx vite` in the background and open `http://localhost:5173/` in a new Chrome tab. Rendering only advances when a screenshot is taken (the automation tab is hidden), so:

1. Take two screenshots about a second apart while no key is held; read the hero's pixels (the 32×32 area at the canvas center, `(384, 284)`) with `getImageData` after each. Expected: they differ (idle bob), with no error text on the canvas.
2. Dispatch `keydown` `ArrowRight` on `window`, take several screenshots, read the hero's pixels each time. Expected: the hero moves right and its pixels cycle through more than two distinct patterns (walk). Dispatch `keyup`.
3. Repeat with `ArrowLeft`. Expected: the hero is mirrored (faces left).

Then stop the dev server (kill the node process whose command line contains `vite` via PowerShell `Get-CimInstance Win32_Process`) and confirm port 5173 is free.

- [ ] **Step 9: Commit**

```bash
git add src/game/systems.ts src/game/main.ts public/hero.svg tests/game/systems.test.ts
git commit -m "feat: animated hero with idle and walk clips"
```
