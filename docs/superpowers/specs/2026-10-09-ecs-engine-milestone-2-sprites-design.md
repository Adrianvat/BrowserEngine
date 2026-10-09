# Browser ECS Engine — Milestone 2: Sprites — Design

Date: 2026-10-09
Builds on: `docs/superpowers/specs/2026-10-09-ecs-engine-milestone-1-design.md`

## Goal

Let games draw images. Images are loaded before the game starts, can be single images or sprite sheets (a grid of equal-size frames), and are drawn by a `Sprite` component that supports choosing a frame, sizing, and horizontal/vertical flipping. A `Layer` component controls draw order for everything drawable.

## Constraints

All milestone 1 constraints still apply: TypeScript only (strict), no runtime dependencies, Canvas 2D, game code imports only from `src/engine/index.ts`.

## Success criteria

- `npm run dev` shows the demo with a background image behind everything, the player drawn as a sprite-sheet sprite (frame 0 standing, frame 1 moving, facing left/right via flip), and the bouncing rects drawn between the two.
- `npm test`, `npm run typecheck`, `npm run build` pass.

## Architecture changes

```
src/engine/assets/assets.ts          Assets resource, ImageLoader, frame math (new)
src/engine/render/components.ts      + Sprite, Layer
src/engine/render/systems.ts         renderRects → render (rects + sprites, layered)
src/engine/core/game.ts              registers Assets, exposes game.assets, pixelArt option
src/engine/index.ts                  exports Assets, Sprite, Layer + types
src/game/...                         demo updated (see below)
public/background.svg, public/hero.svg  demo art
tests/engine/assets.test.ts, tests/engine/render.test.ts (new)
```

## Assets (`Assets` resource)

```ts
type ImageLoader = (url: string) => Promise<HTMLImageElement>;
interface SheetSource { url: string; frameWidth: number; frameHeight: number }
type ImageSource = string | SheetSource;           // string = single image URL
interface Frame { sx: number; sy: number; sw: number; sh: number }

class Assets {
  constructor(loader?: ImageLoader);                // default: browser Image + decode()
  loadImages(sources: Record<string, ImageSource>): Promise<void>;
  getImage(name: string): HTMLImageElement;
  hasImage(name: string): boolean;
  frameCount(name: string): number;
  getFrame(name: string, index: number): Frame;
}
```

- `loadImages` loads all sources in parallel. **All-or-nothing:** if any fails, none of that batch is registered and the promise rejects with `Failed to load image "<name>" from <url>`. Loading a name that already exists replaces it.
- Image size is read from `image.width` / `image.height`.
- Sheet validation (at load time, rejects the batch): `frameWidth` and `frameHeight` must be positive integers, else `Invalid frame size for image "<name>"`; the image must contain at least one whole frame, else `Image "<name>" (<w>x<h>) is smaller than one <fw>x<fh> frame`. Partial frames at the right/bottom edge are ignored.
- A single image has exactly one frame: the whole image. A single image whose width or height is 0 (e.g. an SVG without `width`/`height` attributes) rejects the batch with `Image "<name>" has no size (<w>x<h>)`.
- Frames are numbered from 0, left to right, then top to bottom: with `cols = floor(w / fw)`, frame `i` is at `sx = (i % cols) * fw`, `sy = floor(i / cols) * fh`.
- `getImage`, `frameCount`, `getFrame` throw `Image "<name>" is not loaded` for unknown names. `getFrame` throws `Frame <i> is out of range for "<name>" (<n> frames)` for non-integer, negative, or too-large indices.
- Default loader: `new Image()`, set `src`, `await image.decode()`.
- Image files live in `public/` and are referenced by root URLs (`/hero.png`).

## Components

```ts
interface SpriteOptions { frame?: number; width?: number; height?: number; flipX?: boolean; flipY?: boolean }

class Sprite {
  image: string; frame: number;            // frame defaults to 0
  width?: number; height?: number;         // undefined → frame's natural size
  flipX: boolean; flipY: boolean;          // default false
  constructor(image: string, options?: SpriteOptions);
}

class Layer { constructor(public value = 0) {} }
```

All fields are public and mutable (an animation system later only changes `frame`).

## Rendering

The built-in render system `render` (replaces `renderRects`; still registered automatically as the first render system):

1. Clears the canvas.
2. Collects every entity with `Transform` + `Rect` and every entity with `Transform` + `Sprite`.
3. Sorts by layer (`Layer.value`, default 0), then entity ID (spawn order), then rect before sprite for an entity that has both.
4. Draws rects as filled rectangles (unchanged) and sprites with `drawImage(image, sx, sy, sw, sh, x, y, w, h)`.

Flipping mirrors the sprite in place (its top-left corner stays at `Transform`): `save()`, `translate(x + (flipX ? w : 0), y + (flipY ? h : 0))`, `scale(flipX ? -1 : 1, flipY ? -1 : 1)`, draw at `0, 0`, `restore()`.

## Game

- `Game` creates an `Assets` resource and exposes it as `game.assets`.
- New option `pixelArt?: boolean` (default false). When true, sets `ctx.imageSmoothingEnabled = false` so scaled pixel art stays sharp.

## Demo

- `public/background.svg` (800×600) drawn as a sprite on `Layer(-1)`.
- `public/hero.svg`: a 32×16 sheet of two 16×16 frames (0 = standing, 1 = moving). Player is `Sprite("hero", { width: 32, height: 32 })` on `Layer(1)`, replacing its `Rect`.
- New demo system `playerAppearance`: frame 1 while the player's velocity is non-zero, else 0; `flipX = true` when moving left, `false` when moving right, unchanged when not moving horizontally.
- `bounce` is split: rect bouncing stays as is (non-player entities with `Rect`); a new `clampPlayer` system keeps the player inside the canvas using its sprite's `width`/`height`.
- `main.ts` awaits `game.assets.loadImages(...)` before `game.start()`, and enables `pixelArt`.
- SVG files have explicit `width`/`height` attributes so their natural size is defined.

## Error handling

Same policy as milestone 1: programmer errors fail fast with descriptive messages (unknown image, bad frame, bad sheet size, failed load).

## Testing

- `assets.test.ts` (fake loader returning `{ width, height }` objects): single image and sheet loading; frame count and frame rects; partial edge frames ignored; failed load message and all-or-nothing; invalid frame size; image smaller than a frame; unknown-name and out-of-range errors; replacing a name.
- `render.test.ts` (fake canvas context recording calls): layer order, spawn order within a layer, rect-before-sprite for one entity, frame source rect, natural vs. explicit size, flipX/flipY transforms, entities missing `Transform` are not drawn.
- Demo: `playerAppearance` and `clampPlayer` unit tests; existing tests updated.
- Manual browser check of the demo.

## Out of scope

Animation, rotation/scale, camera, background (dynamic) loading (see `TODO.md`), audio and other asset types.
