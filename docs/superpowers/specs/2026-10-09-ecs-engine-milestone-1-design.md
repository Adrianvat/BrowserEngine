# Browser ECS Engine — Milestone 1 Design

Date: 2026-10-09

## Goal

A game engine written entirely in TypeScript that runs in the browser and builds browser games only. It is meant both for learning how engines work and for making real games, so code clarity and a stable public API both matter. The engine grows incrementally; this spec covers only the first milestone.

Games built on the engine follow the ECS (Entity–Component–System) pattern: a game defines its own components (data) and systems (logic) and registers them with the engine.

## Constraints

- TypeScript only, strict mode. No runtime dependencies; all engine code is our own.
- Dev tooling is allowed: Vite (dev server/build), Vitest (tests).
- 2D only, rendered with the Canvas 2D API.
- Engine code (`src/engine`) is separate from game code (`src/game`). Games import only from `src/engine/index.ts`.

## Success criteria for Milestone 1

- `npm run dev` serves a demo game in the browser: a player square moved by arrow keys/WASD, plus several squares bouncing off the canvas edges.
- The demo defines its own components and systems using only the engine's public API.
- `npm test` passes unit tests for `World`, `Keyboard`, and the fixed-timestep logic.
- `npm run build` type-checks (strict) and builds without errors.

## Architecture

```
index.html
src/engine/ecs/world.ts        World, Entity, ComponentType, System types
src/engine/core/game.ts        Game: owns World, runs the loop
src/engine/core/timestep.ts    pure fixed-timestep accumulator logic
src/engine/input/keyboard.ts   Keyboard resource
src/engine/render/canvas.ts    Canvas resource (wraps 2D context)
src/engine/render/components.ts Transform, Rect
src/engine/render/systems.ts   built-in rect render system
src/engine/index.ts            public exports
src/game/components.ts         demo game components
src/game/systems.ts            demo game systems
src/game/main.ts               demo game entry point (spawns entities, starts Game)
tests/                         Vitest unit tests
```

## ECS core (`World`)

Storage approach: entities are numeric IDs; one `Map<Entity, Component>` per component class.

- **Entity**: `type Entity = number`. IDs increase monotonically and are never reused.
- **Component**: any class instance. The class constructor is the component's key:
  `type ComponentType<T> = new (...args: any[]) => T`.
- **API**:
  - `spawn(): Entity`
  - `despawn(e: Entity): void` — removes the entity and all its components. No-op if it doesn't exist.
  - `isAlive(e: Entity): boolean`
  - `add<T>(e: Entity, component: T): void` — key is `component.constructor`. Replaces an existing component of the same type. Throws if the entity is not alive.
  - `remove<T>(e: Entity, type: ComponentType<T>): void`
  - `get<T>(e: Entity, type: ComponentType<T>): T | undefined`
  - `has(e: Entity, type: ComponentType<unknown>): boolean`
  - `query(...types)` — returns an array of tuples `[Entity, ...components]`, with component types inferred from the arguments (e.g. `query(Position, Velocity)` → `[Entity, Position, Velocity][]`). Implementation iterates the smallest of the requested component maps and checks membership in the others. Returns a snapshot array, so mutating the world while iterating results is safe. Calling `query()` with no types throws.
- **Resources** (global singletons not tied to an entity), keyed by class:
  - `setResource<T>(resource: T): void`
  - `getResource<T>(type: ComponentType<T>): T` — throws a descriptive error if missing.
  - `hasResource(type): boolean`
- **System**: `type System = (world: World, dt: number) => void`.

## Game and loop

```ts
const game = new Game({ canvas: "#game", width: 800, height: 600 });
game.addSystem(movement);          // update system, fixed 60 Hz
game.addRenderSystem(drawExtra);   // render system, once per frame
game.start();
game.stop();
```

- `canvas` option accepts a CSS selector or an `HTMLCanvasElement`; throws if not found. Sets canvas width/height.
- `Game` creates a `World` (exposed as `game.world`) and registers resources `Keyboard` and `Canvas`.
- `start()` while running and `stop()` while stopped are no-ops. Calling `stop()` from inside a system ends the loop after the current frame.
- The built-in rect render system is registered automatically as the first render system.
- Systems run in registration order. Update systems receive the fixed step `dt` (1/60 s); render systems receive the real frame delta.
- **Fixed timestep** (`timestep.ts`, pure and testable): each frame, elapsed time is clamped to 250 ms and added to an accumulator; while accumulator ≥ step, one update step runs and the step is subtracted. Function returns the number of update steps to run and the new accumulator.
- After each update step, `Keyboard.endStep()` clears per-step pressed state.

## Input (`Keyboard` resource)

- Listens to `keydown`/`keyup`/`blur` on an `EventTarget` (the `window` in the game), using `KeyboardEvent.code` (layout-independent).
- `isDown(code): boolean` — currently held.
- `wasPressed(code): boolean` — went down since the last update step; cleared by `endStep()`. OS key auto-repeat does not re-trigger it.
- Clears all state on window `blur` to avoid stuck keys.
- `attach(target)` adds listeners (called by `game.start()`); `detach()` removes them and clears state (called by `game.stop()`), so a game can be stopped and restarted.
- Event handling is separated from the DOM (`handleKeyDown(code)`, `handleKeyUp(code)`) so it can be unit-tested without a browser.

## Rendering

- `Canvas` resource: holds the `HTMLCanvasElement`, its `CanvasRenderingContext2D`, `width`, `height`.
- Built-in components: `Transform { x, y }` (top-left position in pixels), `Rect { width, height, color }`.
- Built-in render system: clears the canvas, then fills a rectangle for every entity with `Transform` + `Rect`.
- Out of scope: sprites, camera, z-ordering, rotation/scale.

## Demo game (`src/game/main.ts`)

- Game-defined components: `Velocity { x, y }` (pixels/second), `Player` (tag, no fields).
- Systems: `playerInput` (sets player velocity from arrow keys/WASD), `movement` (Transform += Velocity * dt), `bounce` (non-player entities reflect velocity at canvas edges; player is clamped inside the canvas).
- Spawns one player and ~10 bouncing rects with random positions, velocities, colors.

## Error handling

- Programmer errors fail fast with descriptive messages: adding a component to a dead entity, missing resource, missing canvas element, empty query.
- Operations on non-existent entities that are naturally idempotent (`despawn`, `remove`) are no-ops.

## Testing

- Vitest unit tests:
  - `World`: spawn IDs unique/increasing; add/get/has/remove; replacing a component; despawn removes all components; `add` on dead entity throws; query returns only entities with all requested components; query result typing (compile-time); despawning during iteration of query results is safe; resources set/get/missing throws.
  - `Keyboard`: `isDown` vs `wasPressed`; `endStep` clears pressed but not held; blur clears all.
  - `timestep`: step counting, accumulator carry-over, 250 ms clamp.
  - Demo systems: `playerInput` and `movement`.
- Rendering and the loop's DOM wiring are verified manually by running the demo.

## Out of scope (future milestones)

Sprites/image loading, camera, collision, audio, scenes, mouse/touch input, cached queries, archetype storage.
