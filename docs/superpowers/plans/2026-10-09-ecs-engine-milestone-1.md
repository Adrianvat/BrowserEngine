# Browser ECS Engine — Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal TypeScript browser game engine with an ECS core, fixed-timestep loop, keyboard input, Canvas 2D rect rendering, and a demo game built only on the engine's public API.

**Architecture:** Entities are numeric IDs; the `World` stores one `Map<Entity, Component>` per component class and answers typed `query(...)` calls. `Game` owns a `World`, registers `Keyboard` and `Canvas` resources, and runs update systems at a fixed 60 Hz and render systems once per frame. Game code lives in `src/game` and imports only from `src/engine/index.ts`.

**Tech Stack:** TypeScript 7 (strict), Vite 8 (dev server/build), Vitest 5 (tests, Node environment — no DOM emulation needed). Node ≥ 22.12.

**Spec:** `docs/superpowers/specs/2026-10-09-ecs-engine-milestone-1-design.md`

## Global Constraints

- TypeScript only, `strict: true`. No runtime dependencies — `dependencies` in `package.json` stays empty.
- Dev dependencies only: `vite@^8.3.4`, `vitest@^5.0.3`, `typescript@^7.0.2`.
- 2D only, Canvas 2D API.
- `src/game/**` imports engine code only from `src/engine/index.ts` (path `../engine`).
- Programmer errors throw `Error` with descriptive messages; idempotent operations on missing things (`despawn`, `remove`) are no-ops.
- Fixed update step is `1/60` s; frame elapsed time is clamped to `0.25` s.
- `npm test`, `npm run typecheck`, and `npm run build` must all pass at the end of every task (from Task 1 onward; `build` from Task 7, since Vite needs `index.html`).
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **Despawning entities while looping over query results** (e.g. a bullet hits an enemy) — loop must finish, visit every original result, and leave despawned entities gone. Test: Task 2 "despawning during iteration is safe".
2. **Stale entity IDs after despawn** — a new spawn must never reuse an old ID, and adding to the old ID must throw. Test: Task 1 "never reuses IDs".
3. **Holding a key (OS auto-repeat sends repeated keydown)** — `wasPressed` must fire only once per physical press. Test: Task 5 "auto-repeat does not re-trigger wasPressed".
4. **A quick tap that starts and ends between two update steps** — `wasPressed` must still be true at the next step. Test: Task 5 "a tap shorter than one step is still seen".
5. **Tab backgrounded for seconds, or a clock that goes backwards** — no burst of hundreds of updates, no negative time. Test: Task 4 "clamps huge elapsed time" and "ignores negative elapsed time".

---

## File Structure

```
package.json, tsconfig.json, .gitignore      tooling (Task 1)
index.html                                   page hosting the canvas (Task 7)
src/engine/ecs/world.ts                      World, Entity, ComponentType, System (Tasks 1–3)
src/engine/core/timestep.ts                  pure fixed-timestep function (Task 4)
src/engine/input/keyboard.ts                 Keyboard resource (Task 5)
src/engine/render/canvas.ts                  Canvas resource (Task 6)
src/engine/render/components.ts              Transform, Rect (Task 6)
src/engine/render/systems.ts                 renderRects built-in system (Task 6)
src/engine/core/game.ts                      Game: loop + wiring (Task 6)
src/engine/index.ts                          public API (Task 6)
src/game/components.ts                       Velocity, Player (Task 7)
src/game/systems.ts                          playerInput, movement, bounce (Task 7)
src/game/main.ts                             demo entry point (Task 7)
tests/engine/world.test.ts                   (Tasks 1–3)
tests/engine/timestep.test.ts                (Task 4)
tests/engine/keyboard.test.ts                (Task 5)
tests/game/systems.test.ts                   (Task 7)
```

---

### Task 1: Project scaffold + World entities and components

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `src/engine/ecs/world.ts`
- Test: `tests/engine/world.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Entity = number`
  - `type ComponentType<T = unknown> = new (...args: any[]) => T`
  - `class World` with `spawn(): Entity`, `despawn(e: Entity): void`, `isAlive(e: Entity): boolean`, `add<T extends object>(e: Entity, component: T): void`, `remove(e: Entity, type: ComponentType): void`, `get<T>(e: Entity, type: ComponentType<T>): T | undefined`, `has(e: Entity, type: ComponentType): boolean`.
  - Private fields later tasks extend: `stores: Map<ComponentType, Map<Entity, unknown>>`.

- [ ] **Step 1: Create tooling files**

`package.json`:
```json
{
  "name": "browser-engine",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p . && vite build",
    "typecheck": "tsc -p .",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

`.gitignore`:
```
node_modules/
dist/
```

Run: `npm install -D vite@^8.3.4 vitest@^5.0.3 typescript@^7.0.2`
Expected: installs without errors; `package.json` gains a `devDependencies` block.

- [ ] **Step 2: Write the failing tests**

`tests/engine/world.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { World } from "../../src/engine/ecs/world";

class Position {
  constructor(public x = 0, public y = 0) {}
}
class Velocity {
  constructor(public x = 0, public y = 0) {}
}

describe("World entities", () => {
  it("spawns unique, increasing, alive entities", () => {
    const world = new World();
    const a = world.spawn();
    const b = world.spawn();
    expect(b).toBeGreaterThan(a);
    expect(world.isAlive(a)).toBe(true);
    expect(world.isAlive(b)).toBe(true);
  });

  it("despawn kills the entity and removes its components", () => {
    const world = new World();
    const e = world.spawn();
    world.add(e, new Position());
    world.despawn(e);
    expect(world.isAlive(e)).toBe(false);
    expect(world.has(e, Position)).toBe(false);
    expect(world.get(e, Position)).toBeUndefined();
  });

  it("despawn is a no-op for dead or unknown entities", () => {
    const world = new World();
    const e = world.spawn();
    world.despawn(e);
    expect(() => world.despawn(e)).not.toThrow();
    expect(() => world.despawn(9999)).not.toThrow();
  });

  it("never reuses IDs, and adding to a stale ID throws", () => {
    const world = new World();
    const old = world.spawn();
    world.despawn(old);
    const fresh = world.spawn();
    expect(fresh).not.toBe(old);
    expect(() => world.add(old, new Position())).toThrow(/not alive/);
  });
});

describe("World components", () => {
  it("add / get / has return the same instance", () => {
    const world = new World();
    const e = world.spawn();
    const pos = new Position(1, 2);
    world.add(e, pos);
    expect(world.has(e, Position)).toBe(true);
    expect(world.get(e, Position)).toBe(pos);
    expect(world.has(e, Velocity)).toBe(false);
    expect(world.get(e, Velocity)).toBeUndefined();
  });

  it("adding the same component type again replaces it", () => {
    const world = new World();
    const e = world.spawn();
    world.add(e, new Position(1, 1));
    const second = new Position(5, 5);
    world.add(e, second);
    expect(world.get(e, Position)).toBe(second);
  });

  it("remove deletes only that component and is a no-op if absent", () => {
    const world = new World();
    const e = world.spawn();
    world.add(e, new Position());
    world.add(e, new Velocity());
    world.remove(e, Position);
    expect(world.has(e, Position)).toBe(false);
    expect(world.has(e, Velocity)).toBe(true);
    expect(() => world.remove(e, Position)).not.toThrow();
    expect(world.isAlive(e)).toBe(true);
  });

  it("adding to a dead entity throws a descriptive error", () => {
    const world = new World();
    const e = world.spawn();
    world.despawn(e);
    expect(() => world.add(e, new Position())).toThrow(
      `Cannot add Position to entity ${e}: entity is not alive`,
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/engine/ecs/world`.

- [ ] **Step 4: Implement**

`src/engine/ecs/world.ts`:
```ts
/** An entity is just an ID. All of its data lives in component stores. */
export type Entity = number;

/** A component type is the class used to create the component. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ComponentType<T = unknown> = new (...args: any[]) => T;

export class World {
  private nextId = 1;
  private readonly alive = new Set<Entity>();
  /** One store per component class: entity -> component instance. */
  private readonly stores = new Map<ComponentType, Map<Entity, unknown>>();

  spawn(): Entity {
    const entity = this.nextId++;
    this.alive.add(entity);
    return entity;
  }

  despawn(entity: Entity): void {
    if (!this.alive.delete(entity)) return;
    for (const store of this.stores.values()) store.delete(entity);
  }

  isAlive(entity: Entity): boolean {
    return this.alive.has(entity);
  }

  add<T extends object>(entity: Entity, component: T): void {
    const type = component.constructor as ComponentType<T>;
    if (!this.alive.has(entity)) {
      throw new Error(`Cannot add ${type.name} to entity ${entity}: entity is not alive`);
    }
    let store = this.stores.get(type);
    if (!store) {
      store = new Map();
      this.stores.set(type, store);
    }
    store.set(entity, component);
  }

  remove(entity: Entity, type: ComponentType): void {
    this.stores.get(type)?.delete(entity);
  }

  get<T>(entity: Entity, type: ComponentType<T>): T | undefined {
    return this.stores.get(type)?.get(entity) as T | undefined;
  }

  has(entity: Entity, type: ComponentType): boolean {
    return this.stores.get(type)?.has(entity) ?? false;
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test` → Expected: PASS (8 tests).
Run: `npm run typecheck` → Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore src tests
git commit -m "feat(ecs): add World with entities and components

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: World queries

**Files:**
- Modify: `src/engine/ecs/world.ts`
- Test: `tests/engine/world.test.ts` (append)

**Interfaces:**
- Consumes: `World`, `Entity`, `ComponentType`, private `stores` (Task 1).
- Produces: `World.query<T extends ComponentType[]>(...types: T): [Entity, ...InstancesOf<T>][]` — e.g. `query(Position, Velocity)` is typed `[Entity, Position, Velocity][]`. Returns a new array each call (snapshot).

- [ ] **Step 1: Write the failing tests**

Change the first import line of `tests/engine/world.test.ts` to:
```ts
import { describe, it, expect, expectTypeOf } from "vitest";
import { World, type Entity } from "../../src/engine/ecs/world";
```

Add below the `Velocity` class:
```ts
class Tag {}
```

Append:
```ts
describe("World.query", () => {
  it("returns only entities that have every requested component, in argument order", () => {
    const world = new World();
    const moving = world.spawn();
    const pos = new Position(1, 2);
    const vel = new Velocity(3, 4);
    world.add(moving, pos);
    world.add(moving, vel);
    const still = world.spawn();
    world.add(still, new Position());

    expect(world.query(Position, Velocity)).toEqual([[moving, pos, vel]]);
    const [row] = world.query(Velocity, Position);
    expect(row[1]).toBe(vel);
    expect(row[2]).toBe(pos);
    expect(world.query(Position).map(([e]) => e)).toEqual([moving, still]);
  });

  it("is fully typed", () => {
    const world = new World();
    expectTypeOf(world.query(Position, Velocity)).toEqualTypeOf<[Entity, Position, Velocity][]>();
    expectTypeOf(world.query(Tag)).toEqualTypeOf<[Entity, Tag][]>();
  });

  it("works with field-less tag components", () => {
    const world = new World();
    const e = world.spawn();
    world.add(e, new Tag());
    expect(world.query(Tag).map(([id]) => id)).toEqual([e]);
  });

  it("returns an empty array for a component type that was never added", () => {
    const world = new World();
    const e = world.spawn();
    world.add(e, new Position());
    expect(world.query(Position, Velocity)).toEqual([]);
  });

  it("throws when called with no component types", () => {
    const world = new World();
    expect(() => world.query()).toThrow("query() requires at least one component type");
  });

  it("despawning during iteration is safe", () => {
    const world = new World();
    const ids = [world.spawn(), world.spawn(), world.spawn()];
    for (const id of ids) world.add(id, new Position());

    const visited: Entity[] = [];
    for (const [e] of world.query(Position)) {
      visited.push(e);
      world.despawn(e);
    }
    expect(visited).toEqual(ids);
    expect(world.query(Position)).toEqual([]);
  });

  it("entities added during iteration are not part of the current results", () => {
    const world = new World();
    world.add(world.spawn(), new Position());
    let count = 0;
    world.query(Position).forEach(() => {
      count++;
      world.add(world.spawn(), new Position());
    });
    expect(count).toBe(1);
    expect(world.query(Position)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `world.query is not a function`.

- [ ] **Step 3: Implement**

In `src/engine/ecs/world.ts`, add after the `ComponentType` type:
```ts
/** Maps a tuple of component classes to a tuple of their instances. */
type InstancesOf<T extends ComponentType[]> = {
  [K in keyof T]: T[K] extends ComponentType<infer I> ? I : never;
};
```

Add this method at the end of the `World` class:
```ts
  /**
   * Returns [entity, ...components] for every entity that has all the given
   * component types. The result is a fresh array, so it is safe to spawn,
   * despawn, add or remove while looping over it.
   */
  query<T extends ComponentType[]>(...types: T): [Entity, ...InstancesOf<T>][] {
    if (types.length === 0) {
      throw new Error("query() requires at least one component type");
    }
    const stores: Map<Entity, unknown>[] = [];
    for (const type of types) {
      const store = this.stores.get(type);
      if (!store) return [];
      stores.push(store);
    }

    // Loop over the smallest store; only those entities can match.
    let smallest = stores[0];
    for (const store of stores) {
      if (store.size < smallest.size) smallest = store;
    }

    const results: unknown[][] = [];
    candidates: for (const entity of smallest.keys()) {
      const row: unknown[] = [entity];
      for (const store of stores) {
        if (!store.has(entity)) continue candidates;
        row.push(store.get(entity));
      }
      results.push(row);
    }
    return results as [Entity, ...InstancesOf<T>][];
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test` → Expected: PASS (15 tests).
Run: `npm run typecheck` → Expected: exit 0. (The "is fully typed" test is enforced here: a wrong type makes `tsc` fail.)

- [ ] **Step 5: Commit**

```bash
git add src/engine/ecs/world.ts tests/engine/world.test.ts
git commit -m "feat(ecs): add typed World.query

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: World resources and the System type

**Files:**
- Modify: `src/engine/ecs/world.ts`
- Test: `tests/engine/world.test.ts` (append)

**Interfaces:**
- Consumes: `World`, `ComponentType` (Task 1).
- Produces:
  - `World.setResource<T extends object>(resource: T): void` (keyed by `resource.constructor`, replaces existing)
  - `World.getResource<T>(type: ComponentType<T>): T` (throws if missing)
  - `World.hasResource(type: ComponentType): boolean`
  - `type System = (world: World, dt: number) => void`

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/world.test.ts`:
```ts
class Score {
  constructor(public value = 0) {}
}

describe("World resources", () => {
  it("setResource / getResource return the same, correctly typed instance", () => {
    const world = new World();
    const score = new Score(10);
    world.setResource(score);
    const got = world.getResource(Score);
    expectTypeOf(got).toEqualTypeOf<Score>();
    expect(got).toBe(score);
    expect(world.hasResource(Score)).toBe(true);
  });

  it("setResource replaces an existing resource of the same type", () => {
    const world = new World();
    world.setResource(new Score(1));
    const second = new Score(2);
    world.setResource(second);
    expect(world.getResource(Score)).toBe(second);
  });

  it("getResource throws a descriptive error when missing", () => {
    const world = new World();
    expect(world.hasResource(Score)).toBe(false);
    expect(() => world.getResource(Score)).toThrow(
      "Resource Score not found. Did you call world.setResource(new Score(...))?",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `world.setResource is not a function`.

- [ ] **Step 3: Implement**

In `src/engine/ecs/world.ts`, add after the `InstancesOf` type:
```ts
/** Game logic. Update systems get the fixed step; render systems get the frame time. */
export type System = (world: World, dt: number) => void;
```

Add a field below `stores`:
```ts
  /** Global singletons not tied to an entity (input, canvas, score...). */
  private readonly resources = new Map<ComponentType, unknown>();
```

Add these methods at the end of the class:
```ts
  setResource<T extends object>(resource: T): void {
    this.resources.set(resource.constructor as ComponentType, resource);
  }

  getResource<T>(type: ComponentType<T>): T {
    if (!this.resources.has(type)) {
      throw new Error(
        `Resource ${type.name} not found. Did you call world.setResource(new ${type.name}(...))?`,
      );
    }
    return this.resources.get(type) as T;
  }

  hasResource(type: ComponentType): boolean {
    return this.resources.has(type);
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test` → Expected: PASS (18 tests).
Run: `npm run typecheck` → Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/engine/ecs/world.ts tests/engine/world.test.ts
git commit -m "feat(ecs): add World resources and System type

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Fixed-timestep logic

**Files:**
- Create: `src/engine/core/timestep.ts`
- Test: `tests/engine/timestep.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const FIXED_STEP = 1 / 60`, `const MAX_FRAME_TIME = 0.25` (seconds)
  - `interface StepResult { steps: number; accumulator: number }`
  - `function advance(accumulator: number, elapsed: number, step = FIXED_STEP, maxFrame = MAX_FRAME_TIME): StepResult` — all times in seconds.

Tests use power-of-two step sizes (0.125, 0.0625) so floating-point math is exact.

- [ ] **Step 1: Write the failing tests**

`tests/engine/timestep.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { advance, FIXED_STEP, MAX_FRAME_TIME } from "../../src/engine/core/timestep";

describe("advance", () => {
  it("uses 60 Hz steps and a 250 ms clamp by default", () => {
    expect(FIXED_STEP).toBe(1 / 60);
    expect(MAX_FRAME_TIME).toBe(0.25);
  });

  it("runs no step when less than one step of time has built up", () => {
    expect(advance(0, 0.0625, 0.125)).toEqual({ steps: 0, accumulator: 0.0625 });
  });

  it("runs exactly one step at the boundary", () => {
    expect(advance(0, 0.125, 0.125)).toEqual({ steps: 1, accumulator: 0 });
  });

  it("carries leftover time into the next frame", () => {
    expect(advance(0.0625, 0.125, 0.125)).toEqual({ steps: 1, accumulator: 0.0625 });
  });

  it("runs several steps after a long frame", () => {
    expect(advance(0, 0.375, 0.125, 1)).toEqual({ steps: 3, accumulator: 0 });
  });

  it("clamps huge elapsed time (e.g. a backgrounded tab)", () => {
    expect(advance(0, 5, 0.125, 0.25)).toEqual({ steps: 2, accumulator: 0 });
  });

  it("ignores negative elapsed time", () => {
    expect(advance(0.0625, -1, 0.125)).toEqual({ steps: 0, accumulator: 0.0625 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/engine/core/timestep`.

- [ ] **Step 3: Implement**

`src/engine/core/timestep.ts`:
```ts
/** Update systems always run with this step, in seconds (60 Hz). */
export const FIXED_STEP = 1 / 60;

/** Longest frame we simulate, in seconds. Prevents huge catch-up bursts. */
export const MAX_FRAME_TIME = 0.25;

export interface StepResult {
  /** How many fixed update steps to run this frame. */
  steps: number;
  /** Leftover time to carry into the next frame. */
  accumulator: number;
}

/** Adds a frame's elapsed time and works out how many fixed steps to run. */
export function advance(
  accumulator: number,
  elapsed: number,
  step = FIXED_STEP,
  maxFrame = MAX_FRAME_TIME,
): StepResult {
  let acc = accumulator + Math.min(Math.max(elapsed, 0), maxFrame);
  let steps = 0;
  while (acc >= step) {
    acc -= step;
    steps++;
  }
  return { steps, accumulator: acc };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test` → Expected: PASS (25 tests).
Run: `npm run typecheck` → Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/engine/core/timestep.ts tests/engine/timestep.test.ts
git commit -m "feat(core): add fixed-timestep advance function

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Keyboard resource

**Files:**
- Create: `src/engine/input/keyboard.ts`
- Test: `tests/engine/keyboard.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces `class Keyboard`:
  - `isDown(code: string): boolean`, `wasPressed(code: string): boolean`
  - `endStep(): void` — clears per-step pressed state (Game calls after each update step)
  - `handleKeyDown(code: string): void`, `handleKeyUp(code: string): void`, `clear(): void`
  - `attach(target: EventTarget): void` — listens to `keydown`, `keyup`, `blur`; re-attaching detaches first
  - `detach(): void` — removes listeners and clears state; no-op if not attached
- `code` values are `KeyboardEvent.code` strings, e.g. `"ArrowLeft"`, `"KeyA"`, `"Space"`.

Tests run in Node, which has `EventTarget` and `Event`; a fake keyboard event is `Object.assign(new Event("keydown"), { code: "KeyA" })`.

- [ ] **Step 1: Write the failing tests**

`tests/engine/keyboard.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Keyboard } from "../../src/engine/input/keyboard";

function keyEvent(type: "keydown" | "keyup", code: string): Event {
  return Object.assign(new Event(type), { code });
}

describe("Keyboard state", () => {
  it("isDown is true while held", () => {
    const kb = new Keyboard();
    kb.handleKeyDown("KeyA");
    expect(kb.isDown("KeyA")).toBe(true);
    expect(kb.isDown("KeyB")).toBe(false);
    kb.handleKeyUp("KeyA");
    expect(kb.isDown("KeyA")).toBe(false);
  });

  it("wasPressed lasts until endStep; isDown survives endStep", () => {
    const kb = new Keyboard();
    kb.handleKeyDown("Space");
    expect(kb.wasPressed("Space")).toBe(true);
    kb.endStep();
    expect(kb.wasPressed("Space")).toBe(false);
    expect(kb.isDown("Space")).toBe(true);
  });

  it("a tap shorter than one step is still seen", () => {
    const kb = new Keyboard();
    kb.handleKeyDown("Space");
    kb.handleKeyUp("Space");
    expect(kb.wasPressed("Space")).toBe(true);
    expect(kb.isDown("Space")).toBe(false);
  });

  it("auto-repeat does not re-trigger wasPressed", () => {
    const kb = new Keyboard();
    kb.handleKeyDown("Space");
    kb.endStep();
    kb.handleKeyDown("Space"); // OS repeat while still held
    expect(kb.wasPressed("Space")).toBe(false);
    kb.handleKeyUp("Space");
    kb.handleKeyDown("Space"); // a real second press
    expect(kb.wasPressed("Space")).toBe(true);
  });

  it("clear resets everything", () => {
    const kb = new Keyboard();
    kb.handleKeyDown("KeyA");
    kb.clear();
    expect(kb.isDown("KeyA")).toBe(false);
    expect(kb.wasPressed("KeyA")).toBe(false);
  });
});

describe("Keyboard events", () => {
  it("reacts to keydown/keyup events on the attached target", () => {
    const target = new EventTarget();
    const kb = new Keyboard();
    kb.attach(target);
    target.dispatchEvent(keyEvent("keydown", "ArrowLeft"));
    expect(kb.isDown("ArrowLeft")).toBe(true);
    target.dispatchEvent(keyEvent("keyup", "ArrowLeft"));
    expect(kb.isDown("ArrowLeft")).toBe(false);
  });

  it("blur releases all keys (no stuck keys after alt-tab)", () => {
    const target = new EventTarget();
    const kb = new Keyboard();
    kb.attach(target);
    target.dispatchEvent(keyEvent("keydown", "KeyW"));
    target.dispatchEvent(new Event("blur"));
    expect(kb.isDown("KeyW")).toBe(false);
  });

  it("detach stops listening and clears state", () => {
    const target = new EventTarget();
    const kb = new Keyboard();
    kb.attach(target);
    target.dispatchEvent(keyEvent("keydown", "KeyW"));
    kb.detach();
    expect(kb.isDown("KeyW")).toBe(false);
    target.dispatchEvent(keyEvent("keydown", "KeyS"));
    expect(kb.isDown("KeyS")).toBe(false);
    expect(() => kb.detach()).not.toThrow();
  });

  it("attaching to a new target stops listening to the old one", () => {
    const first = new EventTarget();
    const second = new EventTarget();
    const kb = new Keyboard();
    kb.attach(first);
    kb.attach(second);
    first.dispatchEvent(keyEvent("keydown", "KeyA"));
    expect(kb.isDown("KeyA")).toBe(false);
    second.dispatchEvent(keyEvent("keydown", "KeyA"));
    expect(kb.isDown("KeyA")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/engine/input/keyboard`.

- [ ] **Step 3: Implement**

`src/engine/input/keyboard.ts`:
```ts
/**
 * Keyboard state, stored as a World resource.
 * Keys are KeyboardEvent.code values ("ArrowLeft", "KeyA", "Space"...),
 * which name physical keys, so WASD works on any keyboard layout.
 */
export class Keyboard {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private target: EventTarget | null = null;

  private readonly onKeyDown = (event: Event): void => {
    this.handleKeyDown((event as KeyboardEvent).code);
  };
  private readonly onKeyUp = (event: Event): void => {
    this.handleKeyUp((event as KeyboardEvent).code);
  };
  private readonly onBlur = (): void => {
    this.clear();
  };

  /** True while the key is held down. */
  isDown(code: string): boolean {
    return this.held.has(code);
  }

  /** True if the key went down since the last update step. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Called by the game loop after each update step. */
  endStep(): void {
    this.pressed.clear();
  }

  handleKeyDown(code: string): void {
    // A keydown for a key that is already held is OS auto-repeat: ignore it.
    if (!this.held.has(code)) this.pressed.add(code);
    this.held.add(code);
  }

  handleKeyUp(code: string): void {
    this.held.delete(code);
  }

  clear(): void {
    this.held.clear();
    this.pressed.clear();
  }

  attach(target: EventTarget): void {
    this.detach();
    this.target = target;
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("blur", this.onBlur);
  }

  detach(): void {
    if (!this.target) return;
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("blur", this.onBlur);
    this.target = null;
    this.clear();
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test` → Expected: PASS (34 tests).
Run: `npm run typecheck` → Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/engine/input/keyboard.ts tests/engine/keyboard.test.ts
git commit -m "feat(input): add Keyboard resource

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rendering, Game loop, and public API

**Files:**
- Create: `src/engine/render/canvas.ts`, `src/engine/render/components.ts`, `src/engine/render/systems.ts`
- Create: `src/engine/core/game.ts`
- Create: `src/engine/index.ts`

**Interfaces:**
- Consumes: `World`, `System` (Tasks 1–3); `advance`, `FIXED_STEP` (Task 4); `Keyboard` (Task 5).
- Produces:
  - `class Canvas { readonly element: HTMLCanvasElement; readonly ctx: CanvasRenderingContext2D; readonly width: number; readonly height: number }`, constructed `new Canvas(element, width, height)`
  - `class Transform { x: number; y: number }` — `new Transform(x = 0, y = 0)`, top-left in pixels
  - `class Rect { width: number; height: number; color: string }` — `new Rect(width, height, color = "white")`
  - `function renderRects(world: World): void`
  - `interface GameOptions { canvas: string | HTMLCanvasElement; width: number; height: number }`
  - `class Game { readonly world: World; addSystem(s: System): void; addRenderSystem(s: System): void; start(): void; stop(): void }`
  - `src/engine/index.ts` exports: `World`, `Game`, `Keyboard`, `Canvas`, `Transform`, `Rect`, `FIXED_STEP`, and types `Entity`, `ComponentType`, `System`, `GameOptions`.

This task is DOM wiring. It is verified by `typecheck` here and by running the demo in Task 7 (per the spec, rendering and the loop's DOM wiring are checked manually).

- [ ] **Step 1: Create the render module**

`src/engine/render/canvas.ts`:
```ts
/** The game's drawing surface, stored as a World resource. */
export class Canvas {
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly element: HTMLCanvasElement,
    readonly width: number,
    readonly height: number,
  ) {
    element.width = width;
    element.height = height;
    const ctx = element.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context is not available");
    this.ctx = ctx;
  }
}
```

`src/engine/render/components.ts`:
```ts
/** Position of an entity's top-left corner, in pixels. */
export class Transform {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

/** Draws the entity as a filled rectangle. */
export class Rect {
  constructor(
    public width: number,
    public height: number,
    public color = "white",
  ) {}
}
```

`src/engine/render/systems.ts`:
```ts
import type { World } from "../ecs/world";
import { Canvas } from "./canvas";
import { Rect, Transform } from "./components";

/** Built-in render system: clears the canvas and draws every Transform + Rect. */
export function renderRects(world: World): void {
  const { ctx, width, height } = world.getResource(Canvas);
  ctx.clearRect(0, 0, width, height);
  for (const [, transform, rect] of world.query(Transform, Rect)) {
    ctx.fillStyle = rect.color;
    ctx.fillRect(transform.x, transform.y, rect.width, rect.height);
  }
}
```

- [ ] **Step 2: Create the Game**

`src/engine/core/game.ts`:
```ts
import { World, type System } from "../ecs/world";
import { Keyboard } from "../input/keyboard";
import { Canvas } from "../render/canvas";
import { renderRects } from "../render/systems";
import { advance, FIXED_STEP } from "./timestep";

export interface GameOptions {
  /** A CSS selector like "#game", or the canvas element itself. */
  canvas: string | HTMLCanvasElement;
  width: number;
  height: number;
}

export class Game {
  readonly world = new World();
  private readonly updateSystems: System[] = [];
  private readonly renderSystems: System[] = [renderRects];
  private readonly keyboard = new Keyboard();
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
    this.world.setResource(new Canvas(element, options.width, options.height));
    this.world.setResource(this.keyboard);
  }

  /** Adds a system that runs at a fixed 60 Hz. Systems run in the order added. */
  addSystem(system: System): void {
    this.updateSystems.push(system);
  }

  /** Adds a system that runs once per browser frame, after the built-in rect renderer. */
  addRenderSystem(system: System): void {
    this.renderSystems.push(system);
  }

  start(): void {
    if (this.running) return;
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

  private readonly frame = (now: number): void => {
    const elapsed = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const { steps, accumulator } = advance(this.accumulator, elapsed);
    this.accumulator = accumulator;
    for (let i = 0; i < steps; i++) {
      for (const system of this.updateSystems) system(this.world, FIXED_STEP);
      this.keyboard.endStep();
    }
    for (const system of this.renderSystems) system(this.world, elapsed);

    // A system may have called stop() during this frame.
    if (this.running) this.frameId = requestAnimationFrame(this.frame);
  };
}
```

- [ ] **Step 3: Create the public API**

`src/engine/index.ts`:
```ts
export { World } from "./ecs/world";
export type { Entity, ComponentType, System } from "./ecs/world";
export { Game } from "./core/game";
export type { GameOptions } from "./core/game";
export { FIXED_STEP } from "./core/timestep";
export { Keyboard } from "./input/keyboard";
export { Canvas } from "./render/canvas";
export { Transform, Rect } from "./render/components";
```

- [ ] **Step 4: Typecheck and run tests**

Run: `npm run typecheck` → Expected: exit 0.
Run: `npm test` → Expected: PASS (34 tests, unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/engine
git commit -m "feat(engine): add Canvas rendering, Game loop, and public API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Demo game

**Files:**
- Create: `index.html`
- Create: `src/game/components.ts`, `src/game/systems.ts`, `src/game/main.ts`
- Test: `tests/game/systems.test.ts`

**Interfaces:**
- Consumes (only via `../engine`): `Game`, `World` (type), `Keyboard`, `Canvas`, `Transform`, `Rect`.
- Produces: `class Velocity { x; y }` (pixels/second), `class Player {}`, `const PLAYER_SPEED = 300`, systems `playerInput(world)`, `movement(world, dt)`, `bounce(world)`.

- [ ] **Step 1: Write the failing tests**

`tests/game/systems.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Keyboard, Transform, World } from "../../src/engine";
import { Player, Velocity } from "../../src/game/components";
import { movement, playerInput, PLAYER_SPEED } from "../../src/game/systems";

describe("movement", () => {
  it("moves Transform by Velocity * dt", () => {
    const world = new World();
    const e = world.spawn();
    world.add(e, new Transform(0, 0));
    world.add(e, new Velocity(10, -20));
    movement(world, 0.5);
    const t = world.get(e, Transform)!;
    expect(t.x).toBe(5);
    expect(t.y).toBe(-10);
  });
});

describe("playerInput", () => {
  function setup() {
    const world = new World();
    const keyboard = new Keyboard();
    world.setResource(keyboard);
    const player = world.spawn();
    world.add(player, new Player());
    world.add(player, new Velocity());
    const other = world.spawn();
    world.add(other, new Velocity(1, 1));
    return { world, keyboard, player, other };
  }

  it("sets player velocity from arrow keys and WASD", () => {
    const { world, keyboard, player } = setup();
    keyboard.handleKeyDown("ArrowRight");
    keyboard.handleKeyDown("KeyW");
    playerInput(world);
    const v = world.get(player, Velocity)!;
    expect(v.x).toBe(PLAYER_SPEED);
    expect(v.y).toBe(-PLAYER_SPEED);
  });

  it("stops the player when no keys are held, and leaves non-players alone", () => {
    const { world, player, other } = setup();
    world.get(player, Velocity)!.x = 123;
    playerInput(world);
    expect(world.get(player, Velocity)).toEqual(new Velocity(0, 0));
    expect(world.get(other, Velocity)).toEqual(new Velocity(1, 1));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/game/components`.

- [ ] **Step 3: Implement the demo's components and systems**

`src/game/components.ts`:
```ts
/** Movement speed in pixels per second. */
export class Velocity {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

/** Tag: marks the entity controlled by the keyboard. */
export class Player {}
```

`src/game/systems.ts`:
```ts
import { Canvas, Keyboard, Rect, Transform, type World } from "../engine";
import { Player, Velocity } from "./components";

export const PLAYER_SPEED = 300;

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

/** Keeps everything on screen: the player stops at the edges, others bounce. */
export function bounce(world: World): void {
  const { width, height } = world.getResource(Canvas);
  for (const [entity, transform, rect, velocity] of world.query(Transform, Rect, Velocity)) {
    const maxX = width - rect.width;
    const maxY = height - rect.height;

    if (world.has(entity, Player)) {
      transform.x = Math.min(Math.max(transform.x, 0), maxX);
      transform.y = Math.min(Math.max(transform.y, 0), maxY);
      continue;
    }

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` → Expected: PASS (37 tests).

- [ ] **Step 5: Create the entry point and page**

`src/game/main.ts`:
```ts
import { Game, Rect, Transform } from "../engine";
import { Player, Velocity } from "./components";
import { bounce, movement, playerInput } from "./systems";

const WIDTH = 800;
const HEIGHT = 600;
const PLAYER_SIZE = 32;

const game = new Game({ canvas: "#game", width: WIDTH, height: HEIGHT });
const world = game.world;

const player = world.spawn();
world.add(player, new Player());
world.add(player, new Transform((WIDTH - PLAYER_SIZE) / 2, (HEIGHT - PLAYER_SIZE) / 2));
world.add(player, new Rect(PLAYER_SIZE, PLAYER_SIZE, "#4ade80"));
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
game.start();
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Browser Engine Demo</title>
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
        background: #111;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      canvas {
        background: #222;
      }
    </style>
  </head>
  <body>
    <canvas id="game"></canvas>
    <script type="module" src="/src/game/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Verify build, typecheck, tests**

Run: `npm run typecheck` → Expected: exit 0.
Run: `npm test` → Expected: PASS (37 tests).
Run: `npm run build` → Expected: exit 0, `dist/index.html` and a `dist/assets/*.js` bundle created.

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev` (in the background) and open the printed URL (default `http://localhost:5173/`).
Check:
- An 800×600 dark canvas is centered on the page.
- A green 32×32 square sits in the middle; 10 colored squares move and bounce off all four edges, never leaving the canvas.
- Arrow keys and WASD move the green square at a steady speed; it stops when keys are released and cannot leave the canvas.
- Arrow keys do not scroll the page.
- Hold a key, alt-tab away, release it, come back: the square is not stuck moving.
- Switch to another tab for ~5 s and back: squares continue normally, with no big jump through walls.
- Browser console has no errors.

Stop the dev server when done.

- [ ] **Step 8: Commit**

```bash
git add index.html src/game tests/game
git commit -m "feat(game): add demo game built on the engine API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
