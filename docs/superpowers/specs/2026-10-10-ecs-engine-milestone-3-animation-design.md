# Browser ECS Engine — Milestone 3: Frame Animation — Design

Date: 2026-10-10
Builds on: `docs/superpowers/specs/2026-10-09-ecs-engine-milestone-2-sprites-design.md`

## Goal

Let games play frame animations from sprite sheets. Named clips (a frame list, a speed, loop or play once) are declared next to the sheet they belong to. An `Animator` component plays one clip at a time on an entity, and a built-in `animate` system advances it each fixed step by changing `sprite.frame`.

## Constraints

All earlier constraints still apply: TypeScript only (strict), no runtime dependencies, Canvas 2D, game code imports only from `src/engine/index.ts`. The renderer does not change.

## Success criteria

- `npm run dev` shows the demo hero bobbing gently while standing still and cycling through a four-frame walk while moving, still facing the direction of travel.
- `npm test`, `npm run typecheck`, `npm run build` pass.

## Architecture changes

```
src/engine/assets/assets.ts          + AnimationClip, SheetSource.animations, getAnimation, hasAnimation, load-time checks
src/engine/animation/animator.ts     Animator component (new)
src/engine/animation/animate.ts      animate system (new)
src/engine/core/game.ts              runs animate after the game's update systems each fixed step
src/engine/index.ts                  exports Animator + type AnimationClip
src/game/...                         demo updated (see below)
public/hero.svg                      redrawn: 6 frames (idle + walk)
tests/engine/animation.test.ts (new), tests/engine/assets.test.ts, tests/engine/game.test.ts, tests/game/systems.test.ts
```

## Clips (`Assets`)

```ts
interface AnimationClip {
  frames: number[];   // sheet frame indices, in playback order
  fps: number;        // frames per second
  loop?: boolean;     // default true
}

interface SheetSource {
  url: string;
  frameWidth: number;
  frameHeight: number;
  animations?: Record<string, AnimationClip>;
}

class Assets {
  // ...existing methods
  getAnimation(image: string, name: string): AnimationClip;
  hasAnimation(image: string, name: string): boolean;
}
```

- Only sprite sheets can declare animations; a plain-URL image has one frame.
- `getAnimation` returns the clip with `loop` filled in (`true` when omitted). It throws `Image "<image>" is not loaded` for an unknown image and `Animation "<name>" not found for image "<image>"` for an unknown clip. `hasAnimation` returns `false` in both cases.
- Clips are checked when the sheet loads, after its frame count is known. A failure rejects the whole batch (all-or-nothing, like the other load errors):
  - empty `frames`: `Animation "<name>" of image "<image>" has no frames`
  - `fps` not a finite number above 0: `Animation "<name>" of image "<image>" has invalid fps (<fps>)`
  - a frame that is not an integer in `[0, frameCount)`: `Animation "<name>" of image "<image>": frame <f> is out of range (<n> frames)`
- Clips are copied at load time, so later changes to the object passed to `loadImages` have no effect.
- Loading a name that already exists replaces the image and its clips.

## Animator component

```ts
class Animator {
  clip: string;        // name of the playing clip
  time = 0;            // seconds since the clip started
  finished = false;    // true once a loop:false clip has reached its end
  constructor(clip: string);
  play(clip: string): void;
  restart(): void;
}
```

- `play(name)` with a different clip sets `clip = name`, `time = 0`, `finished = false`. With the clip already playing it does nothing, so a system can call it every step.
- `restart()` sets `time = 0` and `finished = false` (replays a finished one-shot).
- Fields are public, like `Sprite`'s; `play` and `restart` are the normal way to change them.

## The `animate` system

Runs once per fixed step for every entity with both `Sprite` and `Animator` (an `Animator` without a `Sprite` is ignored):

1. `clip = assets.getAnimation(sprite.image, animator.clip)` (looked up every step, so changing `sprite.image` takes effect immediately; a missing clip throws).
2. `animator.time += dt`.
3. `position = floor(time * fps + 1e-9)`; the small tolerance keeps float rounding at exact boundaries (e.g. fps 10 after six 1/60 s steps) from dropping a frame.
4. Looping clip: `position %= frames.length`, and `time` is wrapped to stay below one cycle (`frames.length / fps`) so it never grows without limit.
5. One-shot clip: when `position >= frames.length`, `position = frames.length - 1` and `finished = true`.
6. `sprite.frame = clip.frames[position]`. Nothing else on the sprite changes.

## Game

`Game` runs `animate` itself, after all of the game's `addSystem` systems in each fixed step (before the keyboard's end-of-step). A `play()` call in a game system therefore shows its clip's first frame in the same step. `animate` is not exported.

## Demo

- `public/hero.svg`: a 96×16 sheet of six 16×16 frames facing right, with explicit `width`/`height` and `shape-rendering="crispEdges"`. Frames 0–1: idle (1px bob). Frames 2–5: walk cycle (contact, passing, contact with the other leg, passing).
- `main.ts` declares `animations: { idle: { frames: [0, 1], fps: 2 }, walk: { frames: [2, 3, 4, 5], fps: 8 } }` on the hero sheet and adds `new Animator("idle")` to the player.
- `playerAppearance`: `animator.play("walk")` while the velocity is non-zero, else `animator.play("idle")`; flipping unchanged. `STANDING_FRAME` and `MOVING_FRAME` are removed.

## Error handling

Same policy as before: programmer errors fail fast with descriptive messages (bad clip at load time, unknown clip at run time).

## Testing

- `assets.test.ts`: clips stored and returned, `loop` defaults to true, `hasAnimation`, unknown image and unknown clip errors, every load-time check rejects the whole batch (no frames, bad fps, out-of-range / negative / non-integer frame), clips copied at load.
- `animation.test.ts`: frames advance at the clip's fps; looping wraps and keeps `time` within one cycle; one-shot holds its last frame and sets `finished`; `play` resets on switch and does nothing for the same clip; `restart`; an exact boundary at the 60 Hz step lands on the next frame; missing clip throws; `Animator` without `Sprite` skipped.
- `game.test.ts`: `animate` runs after the game's systems within a step.
- `tests/game/systems.test.ts`: `playerAppearance` switches between `walk` and `idle` and flips.
- Manual browser check: idle bob, walk cycle while moving, facing direction; the hero's pixels change over time.

## Out of scope

Per-frame durations (can be added later as an optional clip form), animation events/callbacks, blending, playback speed scaling, animating in render time.
