# Browser ECS Engine — Milestone 4: Scenes and Text — Design

Date: 2026-10-10
Builds on: `docs/superpowers/specs/2026-10-10-ecs-engine-milestone-3-animation-design.md`

## Goal

Let a game be split into scenes (title screen, level, game over). One scene runs at a time. Each scene gets a fresh `World` and its own systems. Data that must outlive a scene lives in global resources shared by every scene's world. A `Text` component lets scenes draw text (menus, scores, hints).

## Constraints

All earlier constraints still apply: TypeScript only (strict), no runtime dependencies, Canvas 2D, game code imports only from `src/engine/index.ts`.

## Success criteria

- `npm run dev` shows a title scene ("Press Enter to start", "Games played: 0"). Enter starts the play scene (the milestone 3 demo plus an "Esc: back to title" hint). Escape returns to the title, which now shows "Games played: 1". Enter again starts a fresh play scene (hero centered, new rects).
- `npm test`, `npm run typecheck`, `npm run build` pass.

## Architecture changes

```
src/engine/scene/scene.ts            Scene, SceneContext types; Scenes resource (new)
src/engine/core/game.ts              scenes, global resources, switching; addSystem/addRenderSystem removed
src/engine/render/components.ts      + Text, TextOptions
src/engine/render/systems.ts         render also draws Text
src/engine/index.ts                  exports Scenes, Text + types Scene, SceneContext, TextOptions
src/game/main.ts                     global resource, scenes, start("title")
src/game/resources.ts                Plays resource (new)
src/game/scenes/title.ts             title scene + startOnEnter (new)
src/game/scenes/play.ts              play scene + backToTitle (new)
tests/engine/game.test.ts, tests/engine/render.test.ts, tests/helpers/recording-canvas.ts, tests/game/...
```

## Scenes

```ts
interface Scene {
  setup(scene: SceneContext): void;
}

interface SceneContext {
  readonly world: World;                 // this scene's fresh World
  addSystem(system: System): void;       // fixed 60 Hz, this scene only, in the order added
  addRenderSystem(system: System): void; // once per browser frame, this scene only, after the built-in render
}

class Scenes {                           // a global resource, present in every scene's World
  readonly current: string;              // name of the running scene
  switchTo(name: string): void;          // request a switch
}
```

- `setup` is synchronous. Images are loaded once, before `start`, as before.
- There is no cleanup hook: the old world and its systems are simply dropped.

## Game

- `game.addScene(name, scene)`: registers a scene. A name already registered throws `Scene "<name>" is already added`.
- `game.addGlobalResource(resource)`: registers a resource added to every scene's `World` (the same object every time, so its state carries over). If a scene is running, it is also added to the current world immediately.
- `Canvas`, `Assets`, `Keyboard` and `Scenes` are global resources that `Game` registers itself.
- `game.start(sceneName)`: starts the loop with a fresh instance of that scene (new world, global resources, `setup`). An unknown name throws `Scene "<name>" not found`. Calling `start` while running does nothing (as before).
- `game.world`: a getter for the current scene's world; before the first `start` it throws `No scene is running`.
- `game.canvas`: the `Canvas` resource (alongside `game.assets`), so a loading error can be drawn before any scene exists.
- `game.addSystem` and `game.addRenderSystem` are removed; systems always belong to a scene.
- Each fixed step runs the scene's systems, then `animate`, then the keyboard's end-of-step, then any pending scene switch. Each browser frame then runs the built-in `render` and the scene's render systems on the current world.

## Switching

- `switchTo(name)` only records the request. An unknown name throws `Scene "<name>" not found` immediately, in the calling system.
- The switch happens at the end of the current fixed step (see the order above): the old world and systems are dropped, a new `World` is created, every global resource is added to it, and the new scene's `setup` runs. `Scenes.current` then names the new scene.
- Steps left in the same frame run on the new scene; render draws the new scene.
- Several requests in one step: the last one wins.
- Switching to the running scene restarts it with a fresh world.
- A key pressed on the switching step is not seen by the new scene (`wasPressed` was cleared at end-of-step).
- An exception in `setup` propagates and stops the loop, like an exception in a system.

## Text component

```ts
interface TextOptions {
  size?: number;                          // pixels, default 16
  color?: string;                         // default "white"
  font?: string;                          // CSS font family, default "sans-serif"
  align?: "left" | "center" | "right";    // default "left"
}

class Text {
  value: string;
  size: number;
  color: string;
  font: string;
  align: "left" | "center" | "right";
  constructor(value: string, options?: TextOptions);
}
```

- All fields are public and mutable (e.g. a score display sets `text.value`).
- `render` draws every entity with `Transform` + `Text`: `ctx.font = "<size>px <font>"`, `fillStyle = color`, `textAlign = align`, `textBaseline = "top"`, then `fillText(value, x, y)`. The `Transform` is the top of the text; `align` decides whether `x` is its left edge, center, or right edge.
- Text is sorted with rects and sprites by layer, then entity; within one entity the order is rect, sprite, text (text on top).

## Demo

- `src/game/resources.ts`: `Plays` (`count = 0`), registered with `game.addGlobalResource`.
- `main.ts`: creates the `Game`, loads images (on failure `drawError(game.canvas, error)` and rethrow), registers `Plays`, adds scenes `title` and `play`, calls `game.start("title")`.
- `title` scene: night background; "Press Enter to start" (centered, size 32) and "Games played: N" (centered, smaller) below it. System `startOnEnter`: Enter → `switchTo("play")`.
- `play` scene: the milestone 3 demo (background, hero with animations, 10 bouncing rects, same systems); its `setup` increments `Plays.count`; a small "Esc: back to title" hint in a corner. System `backToTitle`: Escape → `switchTo("title")`.

## Error handling

Same policy as before: programmer errors fail fast with descriptive messages (duplicate scene, unknown scene, no scene running).

## Testing

- `game.test.ts` (loop tests move to a test scene): `start` runs `setup` and the scene's systems, in order with `animate`; duplicate and unknown scene names throw; `game.world` before `start` throws; global resources are the same object in every scene and the built-in ones are present; `addGlobalResource` while running adds to the current world; a switch waits until the end of the step (a system after `switchTo` still sees the old world; the next step runs the new scene); last request wins; switching to the running scene gives a new world; `switchTo` with an unknown name throws immediately; a key pressed on the switching step is not seen by the new scene; steps left in the same frame run on the new scene.
- `render.test.ts`: text drawn with the right font, color, alignment and top baseline; sorted by layer with rects and sprites; an entity's text drawn on top of its own rect and sprite.
- Demo: `startOnEnter`, `backToTitle`, the play scene incrementing `Plays.count`, the title showing the count.
- Manual browser check of the success-criteria flow.

## Out of scope

Scene stack (pause overlays), transitions/fades, per-scene asset loading, a scene cleanup hook, passing data through `switchTo`, multi-line text, word wrap, text measurement, outlines/shadows.
