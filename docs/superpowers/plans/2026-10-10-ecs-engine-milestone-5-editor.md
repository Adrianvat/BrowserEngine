# Milestone 5: Scene Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn scenes into data (starting entities saved as JSON) plus code (systems), and add a browser editor page that adds, removes, edits and drags entities and saves scenes to localStorage for the game page to play.

**Architecture:**
- **Engine:** gains a component registry (names + editable field kinds), scene data parse/validate/spawn, a `SceneStore` over localStorage, a `Name` component, and a `GameDefinition` type. `Game` spawns a scene's data (saved copy, otherwise default) before its `setup`.
- **Demo:** moves its starting entities into `title.json`/`play.json` and a shared `definition.ts`.
- **Editor:** `editor.html` + `src/editor/`. A Node-tested `EditorModel` and hit testing, plus thin DOM views: top bar, entity list, inspector, and a viewport drawn with the engine's `render`.

**Tech Stack:** TypeScript 7 (strict), Vite 8 (multi-page build via `build.rolldownOptions.input`), Vitest 5 (Node environment, no DOM), no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-10-ecs-engine-milestone-5-editor-design.md`

## Global Constraints

- TypeScript only, strict; no runtime dependencies; Canvas 2D.
- Game code (`src/game/`) and editor code (`src/editor/`) import engine code only from `src/engine/index.ts`. The editor also imports `src/game/definition.ts`.
- Storage key: `browser-engine:scene:<scene>`. Scene data version: `1`.
- Error messages exactly as in the spec, including:
  - `Component "<name>" is already registered`
  - `Scene data is not valid JSON: <msg>`
  - `Scene data must be an object with "version" and "entities"`
  - `Unsupported scene data version: <v>`
  - `Entity <i> must have a "name" string and a "components" object`
  - `Entity <i> ("<name>"): unknown component "<c>"`
  - `Entity <i> ("<name>"): <C> must be an object of field values`
  - `Entity <i> ("<name>"): <C> has no field "<f>"`
  - `Entity <i> ("<name>"): <C>.<f> must be <kind text>`
  - `Browser storage is not available`
  - `Scene "<scene>": <message>`
  - `Cannot draw this scene: <message>`
- New no-argument defaults: `Rect(32, 32, "white")`, `Sprite("")`, `Text("")`, `Animator("")`, `Name("")`.
- Editor status texts: `Saved`, `Default (not edited)`, `Not saved: <reason>`.
- Marker: 9×9 cross centered on the Transform.
- Verification commands: `npm test`, `npm run typecheck`, `npm run build`.

## Review Focus

- **Typing in an inspector field.** Each keystroke changes the model and redraws, but the field must keep focus and cursor (Task 9 refreshes values in place and skips the focused input; checked in the browser).
- **Editing must never change the imported default JSON**, so Reset truly restores it (Task 2 test: validate returns a copy; Task 6 test: reset after edits).
- **Field names that are inherited object keys** (`toString`, `constructor`) must be rejected cleanly, in data and in model calls (Task 2 test; Task 6 uses `Object.hasOwn`).
- **A saved scene that no longer validates** (e.g. a component removed from code) must show a named error on the game page and a reset path in the editor (Task 4 and Task 6 tests).
- **Dragging on a canvas that CSS has scaled down** must move by scene pixels (Task 8 `toScene`; checked in the browser at a narrow window).

## File Structure

```
src/engine/ecs/name.ts                 create: Name, findByName
src/engine/data/registry.ts            create: FieldKind, ComponentDefinition, component, ComponentRegistry
src/engine/data/scene-data.ts          create: SceneData, parse/validate/spawn, fitsKind, describeKind
src/engine/data/scene-store.ts         create: SceneStore, browserSceneStore
src/engine/core/definition.ts          create: GameDefinition, SceneEntry
src/engine/core/game.ts                modify: registry, store, scene data
src/engine/render/components.ts        modify: no-arg defaults
src/engine/animation/animator.ts       modify: no-arg default
src/engine/index.ts                    modify: exports
src/game/definition.ts                 create
src/game/scenes/title.json, play.json  create
src/game/scenes/title.ts, play.ts      modify
src/game/main.ts                       modify
src/editor/model.ts                    create: EditorModel
src/editor/hit-test.ts                 create
src/editor/main.ts                     create
src/editor/views/top-bar.ts            create
src/editor/views/viewport.ts           create
src/editor/views/entity-list.ts        create
src/editor/views/inspector.ts          create
editor.html, vite.config.ts            create
tsconfig.json                          modify: resolveJsonModule
tests/helpers/memory-storage.ts        create
tests/engine/registry.test.ts, scene-data.test.ts, scene-store.test.ts   create
tests/engine/game.test.ts              modify
tests/game/scenes.test.ts              modify
tests/game/definition.test.ts          create
tests/editor/model.test.ts, hit-test.test.ts   create
```

---

### Task 1: Component registry, `Name`, and no-argument defaults

**Files:**
- Create: `src/engine/ecs/name.ts`
- Create: `src/engine/data/registry.ts`
- Modify: `src/engine/render/components.ts`
- Modify: `src/engine/animation/animator.ts`
- Modify: `src/engine/index.ts`
- Test: `tests/engine/registry.test.ts`

**Interfaces:**
- Consumes: `World`, `Entity`, `ComponentType`, `Transform`, `Rect`, `Sprite`, `Layer`, `Text`, `Animator`.
- Produces:
  - `class Name { constructor(public value = "") }`
  - `findByName(world: World, name: string): Entity | undefined`
  - `type FieldKind = "number" | "optionalNumber" | "string" | "boolean" | "color" | "image" | { readonly choice: readonly string[] }`
  - `interface ComponentDefinition { readonly type: ComponentType; readonly name: string; readonly fields: Readonly<Record<string, FieldKind>> }`
  - `component<T>(type: new () => T, name: string, fields: { [K in keyof T]?: FieldKind }): ComponentDefinition`
  - `class ComponentRegistry { constructor(definitions?: readonly ComponentDefinition[]); get(name): ComponentDefinition | undefined; nameOf(type): string | undefined; all(): ComponentDefinition[] }`
  - All exported from `src/engine/index.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/engine/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Animator } from "../../src/engine/animation/animator";
import { component, ComponentRegistry } from "../../src/engine/data/registry";
import { findByName, Name } from "../../src/engine/ecs/name";
import { World } from "../../src/engine/ecs/world";
import { Layer, Rect, Sprite, Text, Transform } from "../../src/engine/render/components";

class Velocity {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

describe("ComponentRegistry", () => {
  it("has the built-in components first, then the given ones", () => {
    const registry = new ComponentRegistry([
      component(Velocity, "Velocity", { x: "number", y: "number" }),
    ]);
    expect(registry.all().map((definition) => definition.name)).toEqual([
      "Transform",
      "Rect",
      "Sprite",
      "Layer",
      "Text",
      "Animator",
      "Velocity",
    ]);
  });

  it("describes each built-in's editable fields", () => {
    const registry = new ComponentRegistry();
    expect(registry.get("Transform")?.fields).toEqual({ x: "number", y: "number" });
    expect(registry.get("Rect")?.fields).toEqual({
      width: "number",
      height: "number",
      color: "color",
    });
    expect(registry.get("Sprite")?.fields).toEqual({
      image: "image",
      frame: "number",
      width: "optionalNumber",
      height: "optionalNumber",
      flipX: "boolean",
      flipY: "boolean",
    });
    expect(registry.get("Layer")?.fields).toEqual({ value: "number" });
    expect(registry.get("Text")?.fields).toEqual({
      value: "string",
      size: "number",
      color: "color",
      font: "string",
      align: { choice: ["left", "center", "right"] },
    });
    expect(registry.get("Animator")?.fields).toEqual({ clip: "string" });
  });

  it("finds a definition by name and a name by class", () => {
    const registry = new ComponentRegistry([component(Velocity, "Velocity", {})]);
    expect(registry.get("Velocity")?.type).toBe(Velocity);
    expect(registry.get("Nope")).toBeUndefined();
    expect(registry.nameOf(Sprite)).toBe("Sprite");
    expect(registry.nameOf(Velocity)).toBe("Velocity");
    expect(registry.nameOf(Name)).toBeUndefined();
  });

  it("rejects a name registered twice", () => {
    expect(
      () =>
        new ComponentRegistry([
          component(Velocity, "Velocity", {}),
          component(Velocity, "Velocity", {}),
        ]),
    ).toThrow('Component "Velocity" is already registered');
  });

  it("rejects a game component that reuses a built-in's name", () => {
    expect(() => new ComponentRegistry([component(Velocity, "Transform", {})])).toThrow(
      'Component "Transform" is already registered',
    );
  });
});

describe("no-argument constructors", () => {
  it("give every built-in component usable defaults", () => {
    expect(new Transform()).toMatchObject({ x: 0, y: 0 });
    expect(new Rect()).toMatchObject({ width: 32, height: 32, color: "white" });
    expect(new Sprite().image).toBe("");
    expect(new Layer().value).toBe(0);
    expect(new Text().value).toBe("");
    expect(new Animator().clip).toBe("");
    expect(new Name().value).toBe("");
  });
});

describe("findByName", () => {
  it("returns the first entity with that name, in spawn order", () => {
    const world = new World();
    const a = world.spawn();
    const b = world.spawn();
    const c = world.spawn();
    world.add(a, new Name("x"));
    // c gets its Name before b, so a plain store walk would find c first.
    world.add(c, new Name("y"));
    world.add(b, new Name("y"));
    expect(findByName(world, "y")).toBe(b);
  });

  it("returns undefined when no entity has that name", () => {
    const world = new World();
    world.add(world.spawn(), new Name("x"));
    expect(findByName(world, "z")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/engine/registry.test.ts`
Expected: FAIL — `../../src/engine/data/registry` cannot be resolved.

- [ ] **Step 3: Add `Name`**

Create `src/engine/ecs/name.ts`:

```ts
import type { Entity, World } from "./world";

/** An entity's name, as shown and edited in the editor. */
export class Name {
  constructor(public value = "") {}
}

/** The first entity, in spawn order, with this name. */
export function findByName(world: World, name: string): Entity | undefined {
  let found: Entity | undefined;
  for (const [entity, entityName] of world.query(Name)) {
    if (entityName.value === name && (found === undefined || entity < found)) found = entity;
  }
  return found;
}
```

- [ ] **Step 4: Give the built-in components no-argument defaults**

In `src/engine/render/components.ts`, change the `Rect` constructor to:

```ts
  constructor(
    public width = 32,
    public height = 32,
    public color = "white",
  ) {}
```

change the `Sprite` constructor's first parameter from `public image: string,` to:

```ts
    public image = "",
```

and change the `Text` constructor's first parameter from `public value: string,` to:

```ts
    public value = "",
```

In `src/engine/animation/animator.ts`, change `constructor(public clip: string) {}` to:

```ts
  constructor(public clip = "") {}
```

- [ ] **Step 5: Add the registry**

Create `src/engine/data/registry.ts`:

```ts
import { Animator } from "../animation/animator";
import type { ComponentType } from "../ecs/world";
import { Layer, Rect, Sprite, Text, Transform } from "../render/components";

/** How a field is stored in scene data and edited in the editor. */
export type FieldKind =
  | "number"
  /** A number that may be empty (undefined), e.g. Sprite.width meaning "natural size". */
  | "optionalNumber"
  | "string"
  | "boolean"
  /** A CSS color string. */
  | "color"
  /** The name of a loaded image. */
  | "image"
  | { readonly choice: readonly string[] };

/** A component the editor can show and scene data can hold. */
export interface ComponentDefinition {
  readonly type: ComponentType;
  /** The name used in scene data (class names don't survive the production build). */
  readonly name: string;
  /** The fields saved in scene data and shown in the inspector. */
  readonly fields: Readonly<Record<string, FieldKind>>;
}

/** Declares an editable component. Its class must work with `new type()`. */
export function component<T>(
  type: new () => T,
  name: string,
  fields: { [K in keyof T]?: FieldKind },
): ComponentDefinition {
  return { type, name, fields: fields as Record<string, FieldKind> };
}

const builtInComponents: readonly ComponentDefinition[] = [
  component(Transform, "Transform", { x: "number", y: "number" }),
  component(Rect, "Rect", { width: "number", height: "number", color: "color" }),
  component(Sprite, "Sprite", {
    image: "image",
    frame: "number",
    width: "optionalNumber",
    height: "optionalNumber",
    flipX: "boolean",
    flipY: "boolean",
  }),
  component(Layer, "Layer", { value: "number" }),
  component(Text, "Text", {
    value: "string",
    size: "number",
    color: "color",
    font: "string",
    align: { choice: ["left", "center", "right"] },
  }),
  component(Animator, "Animator", { clip: "string" }),
];

/** Every editable component: the built-in ones, then the game's own. */
export class ComponentRegistry {
  private readonly byName = new Map<string, ComponentDefinition>();
  private readonly byType = new Map<ComponentType, ComponentDefinition>();

  constructor(definitions: readonly ComponentDefinition[] = []) {
    for (const definition of [...builtInComponents, ...definitions]) {
      if (this.byName.has(definition.name)) {
        throw new Error(`Component "${definition.name}" is already registered`);
      }
      this.byName.set(definition.name, definition);
      this.byType.set(definition.type, definition);
    }
  }

  get(name: string): ComponentDefinition | undefined {
    return this.byName.get(name);
  }

  nameOf(type: ComponentType): string | undefined {
    return this.byType.get(type)?.name;
  }

  all(): ComponentDefinition[] {
    return [...this.byName.values()];
  }
}
```

In `src/engine/index.ts`, add after the `World` lines:

```ts
export { Name, findByName } from "./ecs/name";
export { component, ComponentRegistry } from "./data/registry";
export type { ComponentDefinition, FieldKind } from "./data/registry";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/engine/registry.test.ts`
Expected: PASS, 8 tests.

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/engine tests/engine/registry.test.ts
git commit -m "feat: component registry, Name component and no-argument defaults"
```

---

### Task 2: Scene data — parse, validate, spawn

**Files:**
- Create: `src/engine/data/scene-data.ts`
- Modify: `src/engine/index.ts`
- Test: `tests/engine/scene-data.test.ts`

**Interfaces:**
- Consumes: `ComponentRegistry`, `FieldKind` (Task 1); `Name` (Task 1); `World`, `Entity`.
- Produces:
  - `interface EntityData { name: string; components: Record<string, Record<string, unknown>> }`
  - `interface SceneData { version: 1; entities: EntityData[] }`
  - `parseSceneData(text: string, registry: ComponentRegistry): SceneData`
  - `validateSceneData(value: unknown, registry: ComponentRegistry): SceneData` (always returns fresh objects)
  - `spawnSceneData(world: World, data: SceneData, registry: ComponentRegistry): Entity[]`
  - `fitsKind(kind: FieldKind, value: unknown): boolean`
  - `describeKind(kind: FieldKind): string` (e.g. `"a number"`, `"one of left, center, right"`)
  - All exported from `src/engine/index.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/engine/scene-data.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { component, ComponentRegistry } from "../../src/engine/data/registry";
import {
  parseSceneData,
  spawnSceneData,
  validateSceneData,
} from "../../src/engine/data/scene-data";
import { Name } from "../../src/engine/ecs/name";
import { World } from "../../src/engine/ecs/world";
import { Transform } from "../../src/engine/render/components";

/** A component with one field of every kind. */
class Gadget {
  count = 1;
  size?: number;
  label = "a";
  on = false;
  tint = "red";
  picture = "x";
  mode = "low";
}

const registry = new ComponentRegistry([
  component(Gadget, "Gadget", {
    count: "number",
    size: "optionalNumber",
    label: "string",
    on: "boolean",
    tint: "color",
    picture: "image",
    mode: { choice: ["low", "high"] },
  }),
]);

function scene(...entities: unknown[]) {
  return { version: 1, entities };
}

/** One entity named "G" with a Gadget holding these field values. */
function gadget(fields: Record<string, unknown>) {
  return scene({ name: "G", components: { Gadget: fields } });
}

describe("spawnSceneData", () => {
  it("spawns entities in order with their name and components", () => {
    const world = new World();
    const data = validateSceneData(
      scene(
        { name: "A", components: { Transform: { x: 1, y: 2 } } },
        { name: "B", components: {} },
      ),
      registry,
    );
    const [a, b] = spawnSceneData(world, data, registry);
    expect(world.get(a, Name)?.value).toBe("A");
    expect(world.get(a, Transform)).toEqual(new Transform(1, 2));
    expect(world.get(b, Name)?.value).toBe("B");
    expect(world.has(b, Transform)).toBe(false);
  });

  it("sets fields of every kind", () => {
    const values = {
      count: 5,
      size: 12,
      label: "hi",
      on: true,
      tint: "#ff0000",
      picture: "hero",
      mode: "high",
    };
    const world = new World();
    const [entity] = spawnSceneData(world, validateSceneData(gadget(values), registry), registry);
    const spawned = world.get(entity, Gadget);
    expect(spawned).toBeInstanceOf(Gadget);
    expect({ ...spawned }).toEqual(values);
  });

  it("keeps constructor defaults for fields the data leaves out", () => {
    const world = new World();
    const [entity] = spawnSceneData(
      world,
      validateSceneData(gadget({ count: 7 }), registry),
      registry,
    );
    expect({ ...world.get(entity, Gadget) }).toEqual({
      count: 7,
      label: "a",
      on: false,
      tint: "red",
      picture: "x",
      mode: "low",
    });
  });
});

describe("validateSceneData", () => {
  it("returns a copy, so editing the result leaves the input alone", () => {
    const input = scene({ name: "A", components: { Transform: { x: 1 } } });
    const data = validateSceneData(input, registry);
    data.entities[0].name = "B";
    data.entities[0].components.Transform.x = 9;
    expect(input).toEqual(scene({ name: "A", components: { Transform: { x: 1 } } }));
  });

  const shape = 'Scene data must be an object with "version" and "entities"';
  const entityShape = 'Entity 0 must have a "name" string and a "components" object';
  it.each([
    [null, shape],
    [[], shape],
    [{ version: 1 }, shape],
    [{ version: 2, entities: [] }, "Unsupported scene data version: 2"],
    [scene("nope"), entityShape],
    [scene({ name: 1, components: {} }), entityShape],
    [scene({ name: "A", components: [] }), entityShape],
    [
      scene({ name: "A", components: {} }, { name: "B", components: { Ghost: {} } }),
      'Entity 1 ("B"): unknown component "Ghost"',
    ],
    [
      scene({ name: "A", components: { Gadget: 3 } }),
      'Entity 0 ("A"): Gadget must be an object of field values',
    ],
    [gadget({ speed: 1 }), 'Entity 0 ("G"): Gadget has no field "speed"'],
    [gadget({ toString: "x" }), 'Entity 0 ("G"): Gadget has no field "toString"'],
    [gadget({ count: "1" }), 'Entity 0 ("G"): Gadget.count must be a number'],
    [gadget({ count: null }), 'Entity 0 ("G"): Gadget.count must be a number'],
    [gadget({ size: null }), 'Entity 0 ("G"): Gadget.size must be a number or empty'],
    [gadget({ label: 2 }), 'Entity 0 ("G"): Gadget.label must be a string'],
    [gadget({ on: "yes" }), 'Entity 0 ("G"): Gadget.on must be true or false'],
    [gadget({ tint: 0 }), 'Entity 0 ("G"): Gadget.tint must be a color'],
    [gadget({ picture: false }), 'Entity 0 ("G"): Gadget.picture must be an image name'],
    [gadget({ mode: "mid" }), 'Entity 0 ("G"): Gadget.mode must be one of low, high'],
  ])("rejects %j", (value, message) => {
    expect(() => validateSceneData(value, registry)).toThrow(message);
  });
});

describe("parseSceneData", () => {
  it("parses and validates JSON text", () => {
    const text = JSON.stringify(scene({ name: "A", components: { Transform: { x: 3 } } }));
    expect(parseSceneData(text, registry)).toEqual(
      scene({ name: "A", components: { Transform: { x: 3 } } }),
    );
  });

  it("rejects text that is not JSON", () => {
    expect(() => parseSceneData("{oops", registry)).toThrow("Scene data is not valid JSON: ");
  });

  it("rejects JSON that is not valid scene data", () => {
    expect(() => parseSceneData('{"version":3,"entities":[]}', registry)).toThrow(
      "Unsupported scene data version: 3",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/engine/scene-data.test.ts`
Expected: FAIL — `../../src/engine/data/scene-data` cannot be resolved.

- [ ] **Step 3: Implement scene data**

Create `src/engine/data/scene-data.ts`:

```ts
import { Name } from "../ecs/name";
import type { Entity, World } from "../ecs/world";
import type { ComponentRegistry, FieldKind } from "./registry";

/** One entity in scene data: its name and its components' field values. */
export interface EntityData {
  name: string;
  /** Registered component name -> field values. */
  components: Record<string, Record<string, unknown>>;
}

/** A scene's starting entities, as saved by the editor. */
export interface SceneData {
  version: 1;
  entities: EntityData[];
}

const KIND_TEXT = {
  number: "a number",
  optionalNumber: "a number or empty",
  string: "a string",
  boolean: "true or false",
  color: "a color",
  image: "an image name",
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value can be stored in a field of this kind. */
export function fitsKind(kind: FieldKind, value: unknown): boolean {
  if (typeof kind === "object") return typeof value === "string" && kind.choice.includes(value);
  switch (kind) {
    case "number":
    case "optionalNumber":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
    case "color":
    case "image":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
  }
}

/** What a field of this kind must hold, for error messages. */
export function describeKind(kind: FieldKind): string {
  return typeof kind === "object" ? `one of ${kind.choice.join(", ")}` : KIND_TEXT[kind];
}

/** Parses saved scene data (JSON text) and checks it against the registry. */
export function parseSceneData(text: string, registry: ComponentRegistry): SceneData {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Scene data is not valid JSON: ${reason}`);
  }
  return validateSceneData(value, registry);
}

/** Checks scene data against the registry and returns a fresh copy of it. */
export function validateSceneData(value: unknown, registry: ComponentRegistry): SceneData {
  if (!isObject(value) || !("version" in value) || !Array.isArray(value.entities)) {
    throw new Error('Scene data must be an object with "version" and "entities"');
  }
  if (value.version !== 1) {
    throw new Error(`Unsupported scene data version: ${String(value.version)}`);
  }
  return {
    version: 1,
    entities: value.entities.map((entity, index) => validateEntity(entity, index, registry)),
  };
}

function validateEntity(entity: unknown, index: number, registry: ComponentRegistry): EntityData {
  if (!isObject(entity) || typeof entity.name !== "string" || !isObject(entity.components)) {
    throw new Error(`Entity ${index} must have a "name" string and a "components" object`);
  }
  const label = `Entity ${index} ("${entity.name}")`;
  const components: Record<string, Record<string, unknown>> = {};
  for (const [componentName, fields] of Object.entries(entity.components)) {
    const definition = registry.get(componentName);
    if (!definition) throw new Error(`${label}: unknown component "${componentName}"`);
    if (!isObject(fields)) {
      throw new Error(`${label}: ${componentName} must be an object of field values`);
    }
    const copy: Record<string, unknown> = {};
    for (const [field, fieldValue] of Object.entries(fields)) {
      // Own keys only, so inherited names like "toString" are not fields.
      if (!Object.hasOwn(definition.fields, field)) {
        throw new Error(`${label}: ${componentName} has no field "${field}"`);
      }
      const kind = definition.fields[field];
      if (!fitsKind(kind, fieldValue)) {
        throw new Error(`${label}: ${componentName}.${field} must be ${describeKind(kind)}`);
      }
      copy[field] = fieldValue;
    }
    components[componentName] = copy;
  }
  return { name: entity.name, components };
}

/**
 * Spawns one entity per entry, in order, with a Name and its components.
 * Each component is built with `new type()`, then gets the data's field values.
 */
export function spawnSceneData(
  world: World,
  data: SceneData,
  registry: ComponentRegistry,
): Entity[] {
  return data.entities.map((entityData) => {
    const entity = world.spawn();
    world.add(entity, new Name(entityData.name));
    for (const [componentName, fields] of Object.entries(entityData.components)) {
      const definition = registry.get(componentName);
      if (!definition) throw new Error(`Unknown component "${componentName}"`);
      const instance = new definition.type() as object;
      Object.assign(instance, fields);
      world.add(entity, instance);
    }
    return entity;
  });
}
```

In `src/engine/index.ts`, add after the registry lines:

```ts
export {
  describeKind,
  fitsKind,
  parseSceneData,
  spawnSceneData,
  validateSceneData,
} from "./data/scene-data";
export type { EntityData, SceneData } from "./data/scene-data";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/engine/scene-data.test.ts`
Expected: PASS, 26 tests.

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/engine tests/engine/scene-data.test.ts
git commit -m "feat: scene data parsing, validation and spawning"
```

---

### Task 3: `SceneStore`

**Files:**
- Create: `src/engine/data/scene-store.ts`
- Create: `tests/helpers/memory-storage.ts`
- Modify: `src/engine/index.ts`
- Test: `tests/engine/scene-store.test.ts`

**Interfaces:**
- Consumes: `SceneData` (Task 2).
- Produces:
  - `type SceneStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">`
  - `class SceneStore { constructor(storage: SceneStorage | null); load(scene): string | null; save(scene, data: SceneData): void; reset(scene): void }`
  - `browserSceneStore(): SceneStore` (uses `localStorage`, or `null` when reading it throws or it is missing)
  - `tests/helpers/memory-storage.ts`: `class MemoryStorage { getItem; setItem; removeItem }` backed by a Map.
  - `SceneStore`, `browserSceneStore` and `type SceneStorage` exported from `src/engine/index.ts`.

- [ ] **Step 1: Write the test helper and the failing tests**

Create `tests/helpers/memory-storage.ts`:

```ts
/** Stands in for localStorage. */
export class MemoryStorage {
  readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}
```

Create `tests/engine/scene-store.test.ts`:

```ts
import { afterEach, describe, it, expect, vi } from "vitest";
import type { SceneData } from "../../src/engine/data/scene-data";
import { browserSceneStore, SceneStore } from "../../src/engine/data/scene-store";
import { MemoryStorage } from "../helpers/memory-storage";

const data: SceneData = { version: 1, entities: [{ name: "A", components: {} }] };

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("SceneStore", () => {
  it("saves under browser-engine:scene:<name> and loads the JSON back", () => {
    const storage = new MemoryStorage();
    const store = new SceneStore(storage);
    expect(store.load("play")).toBeNull();
    store.save("play", data);
    expect(JSON.parse(storage.getItem("browser-engine:scene:play")!)).toEqual(data);
    expect(JSON.parse(store.load("play")!)).toEqual(data);
  });

  it("keeps scenes apart", () => {
    const store = new SceneStore(new MemoryStorage());
    store.save("play", data);
    expect(store.load("title")).toBeNull();
  });

  it("reset deletes the saved copy", () => {
    const store = new SceneStore(new MemoryStorage());
    store.save("play", data);
    store.reset("play");
    expect(store.load("play")).toBeNull();
  });

  it("without storage, loads nothing and refuses to save or reset", () => {
    const store = new SceneStore(null);
    expect(store.load("play")).toBeNull();
    expect(() => store.save("play", data)).toThrow("Browser storage is not available");
    expect(() => store.reset("play")).toThrow("Browser storage is not available");
  });

  it("lets storage errors through", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("Quota exceeded");
    };
    expect(() => new SceneStore(storage).save("play", data)).toThrow("Quota exceeded");
  });
});

describe("browserSceneStore", () => {
  it("uses localStorage when it is available", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    browserSceneStore().save("play", data);
    expect(storage.getItem("browser-engine:scene:play")).not.toBeNull();
  });

  it("has no storage when reading localStorage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Access denied");
      },
    });
    expect(() => browserSceneStore().save("play", data)).toThrow(
      "Browser storage is not available",
    );
  });

  it("has no storage when localStorage does not exist", () => {
    expect(() => browserSceneStore().save("play", data)).toThrow(
      "Browser storage is not available",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/engine/scene-store.test.ts`
Expected: FAIL — `../../src/engine/data/scene-store` cannot be resolved.

- [ ] **Step 3: Implement the store**

Create `src/engine/data/scene-store.ts`:

```ts
import type { SceneData } from "./scene-data";

/** The part of localStorage the store uses. */
export type SceneStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function keyOf(scene: string): string {
  return `browser-engine:scene:${scene}`;
}

/** Scenes saved by the editor, kept in browser storage. */
export class SceneStore {
  constructor(private readonly storage: SceneStorage | null) {}

  /** The saved JSON text, or null when the scene has no saved copy. */
  load(scene: string): string | null {
    return this.storage?.getItem(keyOf(scene)) ?? null;
  }

  save(scene: string, data: SceneData): void {
    this.required().setItem(keyOf(scene), JSON.stringify(data));
  }

  /** Deletes the saved copy, so the scene's default data is used again. */
  reset(scene: string): void {
    this.required().removeItem(keyOf(scene));
  }

  private required(): SceneStorage {
    if (!this.storage) throw new Error("Browser storage is not available");
    return this.storage;
  }
}

/** A store backed by localStorage, or by nothing when the browser blocks it. */
export function browserSceneStore(): SceneStore {
  let storage: SceneStorage | null = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    storage = null;
  }
  return new SceneStore(storage);
}
```

In `src/engine/index.ts`, add after the scene-data lines:

```ts
export { SceneStore, browserSceneStore } from "./data/scene-store";
export type { SceneStorage } from "./data/scene-store";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/engine/scene-store.test.ts`
Expected: PASS, 8 tests.

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/engine tests/engine/scene-store.test.ts tests/helpers/memory-storage.ts
git commit -m "feat: SceneStore keeps edited scenes in browser storage"
```

---

### Task 4: `Game` loads scene data; `GameDefinition`

**Files:**
- Create: `src/engine/core/definition.ts`
- Modify: `src/engine/core/game.ts`
- Modify: `src/engine/index.ts`
- Test: `tests/engine/game.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `ComponentRegistry`, `ComponentDefinition` (Task 1); `parseSceneData`, `validateSceneData`, `spawnSceneData`, `SceneData` (Task 2); `SceneStore` (Task 3); `MemoryStorage` (Task 3).
- Produces:
  - `GameOptions.components?: readonly ComponentDefinition[]`
  - `GameOptions.sceneStore?: SceneStore`
  - `game.registry: ComponentRegistry`
  - `game.addScene(name: string, scene: Scene, data?: unknown): void`
  - `start(name)` checks every scene's data first and throws `Scene "<scene>": <message>`.
  - `interface SceneEntry { scene: Scene; data: unknown }`
  - `interface GameDefinition { width: number; height: number; pixelArt?: boolean; images: Record<string, ImageSource>; components: ComponentDefinition[]; scenes: Record<string, SceneEntry>; firstScene: string }`
  - Both types exported from `src/engine/index.ts`.

- [ ] **Step 1: Write the failing tests**

In `tests/engine/game.test.ts`, add these imports after the existing ones:

```ts
import { component } from "../../src/engine/data/registry";
import { SceneStore } from "../../src/engine/data/scene-store";
import { findByName, Name } from "../../src/engine/ecs/name";
import { MemoryStorage } from "../helpers/memory-storage";
```

Append at the end of the file:

```ts
class Spin {
  speed = 0;
}

const heroData = {
  version: 1,
  entities: [{ name: "Hero", components: { Transform: { x: 5, y: 6 }, Spin: { speed: 2 } } }],
};

/** A game that knows Spin and saves scenes in a fake storage. */
function makeDataGame() {
  const storage = new MemoryStorage();
  const store = new SceneStore(storage);
  const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
  const game = new Game({
    canvas,
    width: 100,
    height: 100,
    components: [component(Spin, "Spin", { speed: "number" })],
    sceneStore: store,
  });
  return { game, store, storage };
}

describe("Scene data", () => {
  it("knows the built-in components and the game's own", () => {
    const { game } = makeDataGame();
    expect(game.registry.get("Transform")).toBeDefined();
    expect(game.registry.get("Spin")?.type).toBe(Spin);
  });

  it("spawns the scene's default data before its setup runs", () => {
    const { game } = makeDataGame();
    let speed: number | undefined;
    game.addScene(
      "main",
      {
        setup: (scene) => {
          const hero = findByName(scene.world, "Hero");
          speed = hero === undefined ? undefined : scene.world.get(hero, Spin)?.speed;
        },
      },
      heroData,
    );
    game.start("main");
    expect(speed).toBe(2);
  });

  it("uses the saved copy instead of the default", () => {
    const { game, store } = makeDataGame();
    store.save("main", { version: 1, entities: [{ name: "Saved", components: {} }] });
    game.addScene("main", { setup() {} }, heroData);
    game.start("main");
    expect(findByName(game.world, "Saved")).toBeDefined();
    expect(findByName(game.world, "Hero")).toBeUndefined();
  });

  it("start throws, naming the scene, when its saved copy is broken", () => {
    const { game, storage } = makeDataGame();
    storage.setItem("browser-engine:scene:main", "{oops");
    game.addScene("main", { setup() {} }, heroData);
    expect(() => game.start("main")).toThrow('Scene "main": Scene data is not valid JSON');
    expect(pendingFrames.size).toBe(0);
  });

  it("start checks every scene's data, not just the first one's", () => {
    const { game } = makeDataGame();
    game.addScene("main", { setup() {} }, heroData);
    game.addScene("other", { setup() {} }, { version: 2, entities: [] });
    expect(() => game.start("main")).toThrow(
      'Scene "other": Unsupported scene data version: 2',
    );
  });

  it("a saved copy using a component the game no longer has is reported", () => {
    const { game, store } = makeDataGame();
    store.save("main", {
      version: 1,
      entities: [{ name: "Old", components: { Gone: {} } }],
    });
    game.addScene("main", { setup() {} });
    expect(() => game.start("main")).toThrow(
      'Scene "main": Entity 0 ("Old"): unknown component "Gone"',
    );
  });

  it("a scene without data starts with no entities", () => {
    const { game } = makeDataGame();
    game.addScene("main", { setup() {} });
    game.start("main");
    expect(game.world.query(Name)).toEqual([]);
  });

  it("reads the saved copy again each time the scene is entered", () => {
    const { game, store } = makeDataGame();
    let switched = false;
    game.addScene(
      "main",
      {
        setup: (scene) =>
          scene.addSystem((world) => {
            if (switched) return;
            switched = true;
            store.save("main", { version: 1, entities: [{ name: "Saved", components: {} }] });
            world.getResource(Scenes).switchTo("main");
          }),
      },
      heroData,
    );
    game.start("main");
    expect(findByName(game.world, "Hero")).toBeDefined();
    tick(20);
    expect(findByName(game.world, "Saved")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/engine/game.test.ts`
Expected: FAIL — the new tests fail (no `registry`, data not spawned); the existing tests pass.

- [ ] **Step 3: Add the definition type**

Create `src/engine/core/definition.ts`:

```ts
import type { ImageSource } from "../assets/assets";
import type { ComponentDefinition } from "../data/registry";
import type { Scene } from "../scene/scene";

/** A scene's code and its default starting entities (imported JSON, checked at start). */
export interface SceneEntry {
  scene: Scene;
  data: unknown;
}

/** Everything both the game page and the editor page need to know about a game. */
export interface GameDefinition {
  width: number;
  height: number;
  pixelArt?: boolean;
  images: Record<string, ImageSource>;
  /** The game's own editable components; the built-in ones are always registered. */
  components: ComponentDefinition[];
  /** In the order the editor lists them. */
  scenes: Record<string, SceneEntry>;
  firstScene: string;
}
```

- [ ] **Step 4: Teach `Game` about scene data**

In `src/engine/core/game.ts`:

Add these imports after the `Assets` import:

```ts
import { ComponentRegistry, type ComponentDefinition } from "../data/registry";
import {
  parseSceneData,
  spawnSceneData,
  validateSceneData,
  type SceneData,
} from "../data/scene-data";
import type { SceneStore } from "../data/scene-store";
```

Add to `GameOptions`, after `pixelArt?: boolean;`:

```ts
  /** The game's own editable components; the built-in ones are always registered. */
  components?: readonly ComponentDefinition[];
  /** Where the editor saves scenes. Without it, scenes use only their default data. */
  sceneStore?: SceneStore;
```

Add after the `ActiveScene` interface:

```ts
/** A scene added to the game, with its default data (if any). */
interface AddedScene {
  scene: Scene;
  data: unknown;
}
```

Replace the field lines

```ts
  readonly assets = new Assets();
  readonly canvas: Canvas;
  private readonly keyboard = new Keyboard();
  private readonly sceneList = new Map<string, Scene>();
```

with:

```ts
  readonly assets = new Assets();
  readonly canvas: Canvas;
  /** The components scene data can use. */
  readonly registry: ComponentRegistry;
  private readonly sceneStore: SceneStore | null;
  private readonly keyboard = new Keyboard();
  private readonly sceneList = new Map<string, AddedScene>();
```

In the constructor, add after `this.canvas.ctx.imageSmoothingEnabled = !options.pixelArt;`:

```ts
    this.registry = new ComponentRegistry(options.components);
    this.sceneStore = options.sceneStore ?? null;
```

Replace `addScene`:

```ts
  addScene(name: string, scene: Scene): void {
    if (this.sceneList.has(name)) throw new Error(`Scene "${name}" is already added`);
    this.sceneList.set(name, scene);
  }
```

with:

```ts
  /** Adds a scene. `data` is its default scene data, used until the editor saves a copy. */
  addScene(name: string, scene: Scene, data?: unknown): void {
    if (this.sceneList.has(name)) throw new Error(`Scene "${name}" is already added`);
    this.sceneList.set(name, { scene, data });
  }
```

In `start`, replace

```ts
    if (this.running) return;
    this.enterScene(sceneName);
```

with:

```ts
    if (this.running) return;
    // Check every scene's data now, so a broken scene fails before the loop starts.
    for (const [name, added] of this.sceneList) this.sceneData(name, added.data);
    this.enterScene(sceneName);
```

Replace the start of `enterScene`

```ts
    const scene = this.sceneList.get(name);
    if (!scene) throw new Error(`Scene "${name}" not found`);
    const world = new World();
```

with:

```ts
    const added = this.sceneList.get(name);
    if (!added) throw new Error(`Scene "${name}" not found`);
    // Read before anything changes, so bad data leaves the running scene alone.
    const data = this.sceneData(name, added.data);
    const world = new World();
```

Replace

```ts
    this.scenes.enter(name);
    scene.setup({
```

with:

```ts
    this.scenes.enter(name);
    if (data) spawnSceneData(world, data, this.registry);
    added.scene.setup({
```

Add after `enterScene`:

```ts
  /** The scene's saved copy if there is one, otherwise its default data (null when none). */
  private sceneData(name: string, defaultData: unknown): SceneData | null {
    try {
      const saved = this.sceneStore?.load(name) ?? null;
      if (saved !== null) return parseSceneData(saved, this.registry);
      return defaultData === undefined ? null : validateSceneData(defaultData, this.registry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Scene "${name}": ${message}`, { cause: error });
    }
  }
```

In `src/engine/index.ts`, add after the `Game` lines:

```ts
export type { GameDefinition, SceneEntry } from "./core/definition";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/engine/game.test.ts`
Expected: PASS, all tests (23 existing + 8 new).

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine tests/engine/game.test.ts
git commit -m "feat: Game spawns each scene's saved or default data before setup"
```

---

### Task 5: The demo as data

**Files:**
- Modify: `tsconfig.json`
- Create: `src/game/scenes/title.json`
- Create: `src/game/scenes/play.json`
- Create: `src/game/definition.ts`
- Modify: `src/game/scenes/title.ts`
- Modify: `src/game/scenes/play.ts`
- Modify: `src/game/main.ts`
- Modify: `tests/game/scenes.test.ts`
- Test: `tests/game/definition.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4 through `src/engine/index.ts`.
- Produces: `export const definition: GameDefinition` in `src/game/definition.ts`, with scenes `title` and `play`, images `background` and `hero`, components `Velocity` and `Player`, and `firstScene: "title"`.

- [ ] **Step 1: Allow JSON imports**

In `tsconfig.json`, add after `"moduleResolution": "bundler",`:

```json
    "resolveJsonModule": true,
```

- [ ] **Step 2: Write the failing tests**

Create `tests/game/definition.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ComponentRegistry,
  findByName,
  spawnSceneData,
  Sprite,
  Transform,
  validateSceneData,
  World,
} from "../../src/engine";
import { definition } from "../../src/game/definition";

const registry = new ComponentRegistry(definition.components);

function spawnDefault(scene: string): World {
  const world = new World();
  spawnSceneData(world, validateSceneData(definition.scenes[scene].data, registry), registry);
  return world;
}

describe("demo game definition", () => {
  it("starts on a scene it declares", () => {
    expect(Object.keys(definition.scenes)).toEqual(["title", "play"]);
    expect(definition.firstScene).toBe("title");
  });

  it.each(["title", "play"])("%s default data is valid", (scene) => {
    expect(() => validateSceneData(definition.scenes[scene].data, registry)).not.toThrow();
  });

  it("only uses images the definition loads", () => {
    for (const scene of Object.keys(definition.scenes)) {
      for (const [, sprite] of spawnDefault(scene).query(Sprite)) {
        expect(Object.keys(definition.images)).toContain(sprite.image);
      }
    }
  });

  it("puts the player in the middle of the play scene", () => {
    const world = spawnDefault("play");
    const player = findByName(world, "Player");
    expect(player).toBeDefined();
    expect(world.get(player!, Transform)).toEqual(new Transform(384, 284));
  });
});
```

In `tests/game/scenes.test.ts`, replace the import lines at the top with:

```ts
import { describe, it, expect } from "vitest";
import {
  ComponentRegistry,
  Keyboard,
  Rect,
  Scenes,
  spawnSceneData,
  Text,
  validateSceneData,
  World,
  type Scene,
  type System,
} from "../../src/engine";
import { Velocity } from "../../src/game/components";
import { definition } from "../../src/game/definition";
import { Plays } from "../../src/game/resources";
import { backToTitle, playScene } from "../../src/game/scenes/play";
import { startOnEnter, titleScene } from "../../src/game/scenes/title";
import { recordingCanvas } from "../helpers/recording-canvas";

const registry = new ComponentRegistry(definition.components);

/** Spawns a scene's default data, as Game does before setup. */
function spawnDefault(world: World, scene: string): void {
  spawnSceneData(world, validateSceneData(definition.scenes[scene].data, registry), registry);
}
```

and replace the `describe("titleScene", ...)` and `describe("playScene", ...)` blocks with:

```ts
describe("titleScene", () => {
  it("shows the number of games played on the Plays label, and listens for Enter", () => {
    const plays = new Plays();
    plays.count = 3;
    const { world } = sceneWorld(plays);
    spawnDefault(world, "title");
    const systems = runSetup(titleScene, world);
    expect(texts(world)).toEqual(["Press Enter to start", "Games played: 3"]);
    expect(systems).toContain(startOnEnter);
  });

  it("still starts when the Plays label was removed in the editor", () => {
    const { world } = sceneWorld();
    expect(() => runSetup(titleScene, world)).not.toThrow();
  });
});

describe("playScene", () => {
  it("counts the play, adds 10 bouncing rects, and listens for Escape", () => {
    const { world, plays } = sceneWorld();
    const systems = runSetup(playScene, world);
    expect(plays.count).toBe(1);
    expect(world.query(Rect, Velocity)).toHaveLength(10);
    expect(systems).toContain(backToTitle);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/game`
Expected: FAIL — `../../src/game/definition` cannot be resolved.

- [ ] **Step 4: Write the scene data files**

Create `src/game/scenes/title.json`:

```json
{
  "version": 1,
  "entities": [
    {
      "name": "Background",
      "components": {
        "Transform": { "x": 0, "y": 0 },
        "Sprite": { "image": "background" },
        "Layer": { "value": -1 }
      }
    },
    {
      "name": "Prompt",
      "components": {
        "Transform": { "x": 400, "y": 260 },
        "Text": { "value": "Press Enter to start", "size": 32, "align": "center" }
      }
    },
    {
      "name": "Plays label",
      "components": {
        "Transform": { "x": 400, "y": 310 },
        "Text": { "value": "Games played: 0", "size": 20, "color": "#cbd5e1", "align": "center" }
      }
    }
  ]
}
```

Create `src/game/scenes/play.json`:

```json
{
  "version": 1,
  "entities": [
    {
      "name": "Background",
      "components": {
        "Transform": { "x": 0, "y": 0 },
        "Sprite": { "image": "background" },
        "Layer": { "value": -1 }
      }
    },
    {
      "name": "Player",
      "components": {
        "Transform": { "x": 384, "y": 284 },
        "Sprite": { "image": "hero", "width": 32, "height": 32 },
        "Layer": { "value": 1 },
        "Velocity": {},
        "Animator": { "clip": "idle" },
        "Player": {}
      }
    },
    {
      "name": "Hint",
      "components": {
        "Transform": { "x": 12, "y": 12 },
        "Text": { "value": "Esc: back to title", "size": 14, "color": "#cbd5e1" },
        "Layer": { "value": 2 }
      }
    }
  ]
}
```

- [ ] **Step 5: Write the definition and slim the scenes down**

Create `src/game/definition.ts`:

```ts
import { component, type GameDefinition } from "../engine";
import { Player, Velocity } from "./components";
import { playScene } from "./scenes/play";
import playData from "./scenes/play.json";
import { titleScene } from "./scenes/title";
import titleData from "./scenes/title.json";

/** The demo game, shared by the game page and the editor page. */
export const definition: GameDefinition = {
  width: 800,
  height: 600,
  pixelArt: true,
  images: {
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
  },
  components: [
    component(Velocity, "Velocity", { x: "number", y: "number" }),
    component(Player, "Player", {}),
  ],
  scenes: {
    title: { scene: titleScene, data: titleData },
    play: { scene: playScene, data: playData },
  },
  firstScene: "title",
};
```

Replace `src/game/scenes/title.ts` with:

```ts
import { findByName, Keyboard, Scenes, Text, type Scene, type World } from "../../engine";
import { Plays } from "../resources";

/** Starts the game when Enter is pressed. */
export function startOnEnter(world: World): void {
  if (world.getResource(Keyboard).wasPressed("Enter")) {
    world.getResource(Scenes).switchTo("play");
  }
}

/** The title screen. Its entities come from title.json. */
export const titleScene: Scene = {
  setup(scene) {
    const { world } = scene;
    // The label may have been removed in the editor.
    const label = findByName(world, "Plays label");
    const text = label === undefined ? undefined : world.get(label, Text);
    if (text) text.value = `Games played: ${world.getResource(Plays).count}`;

    scene.addSystem(startOnEnter);
  },
};
```

Replace `src/game/scenes/play.ts` with:

```ts
import { Canvas, Keyboard, Rect, Scenes, Transform, type Scene, type World } from "../../engine";
import { Velocity } from "../components";
import { Plays } from "../resources";
import { bounce, clampPlayer, movement, playerAppearance, playerInput } from "../systems";

/** Returns to the title screen when Escape is pressed. */
export function backToTitle(world: World): void {
  if (world.getResource(Keyboard).wasPressed("Escape")) {
    world.getResource(Scenes).switchTo("title");
  }
}

/** The hero walking around among bouncing rects. The hero and the hint come from play.json. */
export const playScene: Scene = {
  setup(scene) {
    const { world } = scene;
    const { width, height } = world.getResource(Canvas);
    world.getResource(Plays).count++;

    // Random every time, so these stay in code.
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
    scene.addSystem(backToTitle);
  },
};
```

Replace `src/game/main.ts` with:

```ts
import { browserSceneStore, Game } from "../engine";
import { definition } from "./definition";
import { drawError } from "./errors";
import { Plays } from "./resources";

const game = new Game({
  canvas: "#game",
  width: definition.width,
  height: definition.height,
  pixelArt: definition.pixelArt,
  components: definition.components,
  sceneStore: browserSceneStore(),
});

try {
  await game.assets.loadImages(definition.images);
  game.addGlobalResource(new Plays());
  for (const [name, { scene, data }] of Object.entries(definition.scenes)) {
    game.addScene(name, scene, data);
  }
  game.start(definition.firstScene);
} catch (error) {
  drawError(game.canvas, error);
  throw error;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/game`
Expected: PASS, all game test files.

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Check the game page in the browser**

1. Start `npx vite --port 5173 --strictPort` in the background.
2. Call `tabs_context_mcp` (create the group if it is empty), then navigate a tab to `http://localhost:5173/`.
3. The tab may be hidden, in which case frames only run when a screenshot is taken. So dispatch keys on `window` with `javascript_tool` (`keydown`, then `keyup`), and take a screenshot after each key.

Check, in order:

1. The title shows "Press Enter to start" and "Games played: 0", the same as before.
2. After Enter, the play scene shows the hero centered, the rects and the hint.
3. After Escape, the title shows "Games played: 1".

Then close the tab, stop the dev server (PowerShell `Get-CimInstance Win32_Process`, kill the node process whose command line contains `vite`), and confirm port 5173 is free.

- [ ] **Step 8: Commit**

```bash
git add tsconfig.json src/game tests/game
git commit -m "feat: demo scenes start from JSON data through a shared game definition"
```

---

### Task 6: `EditorModel`

**Files:**
- Create: `src/editor/model.ts`
- Test: `tests/editor/model.test.ts`

**Interfaces:**
- Consumes (from `src/engine/index.ts`): `ComponentRegistry`, `describeKind`, `fitsKind`, `parseSceneData`, `validateSceneData`, `SceneStore`, `type EntityData`, `type GameDefinition`, `type SceneData`.
- Produces:

```ts
type SaveStatus = "saved" | "default" | { error: string };
class EditorModel {
  constructor(definition: GameDefinition, store: SceneStore);
  readonly definition: GameDefinition;
  readonly registry: ComponentRegistry;
  get scene(): string;
  get data(): SceneData;
  get selected(): number | null;
  get status(): SaveStatus;
  get loadError(): string | null;
  get sceneNames(): string[];
  get imageNames(): string[];
  onChange(listener: () => void): void;
  openScene(name: string): void;
  select(index: number | null): void;
  addEntity(): void;
  removeEntity(index: number): void;
  rename(index: number, name: string): void;
  addComponent(index: number, component: string): void;
  removeComponent(index: number, component: string): void;
  setField(index: number, component: string, field: string, value: unknown): void;
  move(index: number, x: number, y: number, save?: boolean): void;
  resetScene(): void;
}
```

Error messages:
- `Scene "<name>" not found`
- `No entity at index <i>`
- `Unknown component "<c>"`
- `Entity <i> already has <c>`
- `Entity <i> has no <c>`
- `<C> has no field "<f>"`
- `<C>.<f> must be <kind text>`
- `Scene "<name>" could not be loaded; reset it to edit it`

- [ ] **Step 1: Write the failing tests**

Create `tests/editor/model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EditorModel } from "../../src/editor/model";
import { component, SceneStore, type GameDefinition } from "../../src/engine";
import { MemoryStorage } from "../helpers/memory-storage";

class Spin {
  speed = 1;
}

const KEY = "browser-engine:scene:";

const definition: GameDefinition = {
  width: 200,
  height: 100,
  images: { hero: "/hero.png", bg: "/bg.png" },
  components: [component(Spin, "Spin", { speed: "number" })],
  scenes: {
    main: {
      scene: { setup() {} },
      data: {
        version: 1,
        entities: [
          { name: "Hero", components: { Transform: { x: 10, y: 20 } } },
          { name: "Box", components: { Rect: {} } },
        ],
      },
    },
    other: { scene: { setup() {} }, data: { version: 1, entities: [] } },
  },
  firstScene: "main",
};

/** A model over a fake storage, optionally holding saved JSON text per scene. */
function setup(saved: Record<string, string> = {}, storage: MemoryStorage | null = new MemoryStorage()) {
  for (const [scene, text] of Object.entries(saved)) storage?.setItem(KEY + scene, text);
  const model = new EditorModel(definition, new SceneStore(storage));
  let changes = 0;
  model.onChange(() => changes++);
  /** What the store holds for a scene, parsed, or null. */
  const stored = (scene = "main") => {
    const text = storage?.getItem(KEY + scene) ?? null;
    return text === null ? null : JSON.parse(text);
  };
  return { model, storage, stored, changes: () => changes };
}

function names(model: EditorModel): string[] {
  return model.data.entities.map((entity) => entity.name);
}

describe("opening scenes", () => {
  it("starts on the first scene with its default data", () => {
    const { model } = setup();
    expect(model.scene).toBe("main");
    expect(names(model)).toEqual(["Hero", "Box"]);
    expect(model.selected).toBeNull();
    expect(model.status).toBe("default");
    expect(model.loadError).toBeNull();
    expect(model.sceneNames).toEqual(["main", "other"]);
    expect(model.imageNames).toEqual(["hero", "bg"]);
  });

  it("loads the saved copy when there is one", () => {
    const saved = JSON.stringify({ version: 1, entities: [{ name: "Saved", components: {} }] });
    const { model } = setup({ main: saved });
    expect(names(model)).toEqual(["Saved"]);
    expect(model.status).toBe("saved");
  });

  it("openScene switches scenes and clears the selection", () => {
    const { model, changes } = setup();
    model.select(0);
    model.openScene("other");
    expect(model.scene).toBe("other");
    expect(names(model)).toEqual([]);
    expect(model.selected).toBeNull();
    expect(changes()).toBe(2);
  });

  it("openScene rejects an unknown scene", () => {
    const { model } = setup();
    expect(() => model.openScene("nope")).toThrow('Scene "nope" not found');
  });
});

describe("selection", () => {
  it("select changes the selection without saving", () => {
    const { model, stored, changes } = setup();
    model.select(1);
    expect(model.selected).toBe(1);
    expect(changes()).toBe(1);
    expect(stored()).toBeNull();
    expect(model.status).toBe("default");
    model.select(null);
    expect(model.selected).toBeNull();
  });

  it("select rejects an index with no entity", () => {
    const { model } = setup();
    expect(() => model.select(5)).toThrow("No entity at index 5");
  });
});

describe("entities", () => {
  it("addEntity adds a named entity at the center of the scene, selects it and saves", () => {
    const { model, stored, changes } = setup();
    model.addEntity();
    expect(names(model)).toEqual(["Hero", "Box", "Entity 1"]);
    expect(model.data.entities[2].components).toEqual({ Transform: { x: 100, y: 50 } });
    expect(model.selected).toBe(2);
    expect(model.status).toBe("saved");
    expect(stored().entities).toHaveLength(3);
    expect(changes()).toBe(1);
  });

  it("names new entities with the smallest unused number", () => {
    const { model } = setup();
    model.addEntity();
    model.addEntity();
    model.addEntity();
    model.removeEntity(3); // "Entity 2"
    model.addEntity();
    expect(names(model)).toEqual(["Hero", "Box", "Entity 1", "Entity 3", "Entity 2"]);
  });

  it("removeEntity removes the entity and saves", () => {
    const { model, stored } = setup();
    model.removeEntity(0);
    expect(names(model)).toEqual(["Box"]);
    expect(stored().entities).toHaveLength(1);
  });

  it("removing the selected entity clears the selection", () => {
    const { model } = setup();
    model.select(0);
    model.removeEntity(0);
    expect(model.selected).toBeNull();
  });

  it("removing an entity before the selected one keeps the same entity selected", () => {
    const { model } = setup();
    model.select(1);
    model.removeEntity(0);
    expect(model.selected).toBe(0);
  });

  it("removing an entity after the selected one leaves the selection alone", () => {
    const { model } = setup();
    model.addEntity();
    model.select(0);
    model.removeEntity(2);
    expect(model.selected).toBe(0);
  });

  it("rename changes the name and saves", () => {
    const { model, stored } = setup();
    model.rename(0, "Player");
    expect(names(model)).toEqual(["Player", "Box"]);
    expect(stored().entities[0].name).toBe("Player");
  });
});

describe("components", () => {
  it("addComponent adds the component with its constructor defaults", () => {
    const { model, stored } = setup();
    model.addComponent(1, "Spin");
    model.addComponent(0, "Rect");
    expect(model.data.entities[1].components.Spin).toEqual({ speed: 1 });
    expect(model.data.entities[0].components.Rect).toEqual({
      width: 32,
      height: 32,
      color: "white",
    });
    expect(stored().entities[0].components.Rect).toBeDefined();
  });

  it("a new Sprite shows the first image and leaves its optional sizes empty", () => {
    const { model } = setup();
    model.addComponent(0, "Sprite");
    const sprite = model.data.entities[0].components.Sprite;
    expect(sprite).toEqual({ image: "hero", frame: 0, flipX: false, flipY: false });
    expect(Object.keys(sprite)).toEqual(["image", "frame", "flipX", "flipY"]);
  });

  it("addComponent rejects a component the entity has, or an unknown one", () => {
    const { model } = setup();
    expect(() => model.addComponent(0, "Transform")).toThrow("Entity 0 already has Transform");
    expect(() => model.addComponent(0, "Ghost")).toThrow('Unknown component "Ghost"');
  });

  it("removeComponent removes it and saves", () => {
    const { model, stored } = setup();
    model.removeComponent(0, "Transform");
    expect(model.data.entities[0].components).toEqual({});
    expect(stored().entities[0].components).toEqual({});
  });

  it("removeComponent rejects a component the entity does not have", () => {
    const { model } = setup();
    expect(() => model.removeComponent(0, "Rect")).toThrow("Entity 0 has no Rect");
    expect(() => model.removeComponent(0, "toString")).toThrow("Entity 0 has no toString");
  });
});

describe("fields", () => {
  it("setField sets the value and saves", () => {
    const { model, stored } = setup();
    model.setField(1, "Rect", "color", "red");
    expect(model.data.entities[1].components.Rect.color).toBe("red");
    expect(stored().entities[1].components.Rect.color).toBe("red");
  });

  it("setting an optional number to undefined leaves it empty", () => {
    const { model } = setup();
    model.addComponent(0, "Sprite");
    model.setField(0, "Sprite", "width", 40);
    expect(model.data.entities[0].components.Sprite.width).toBe(40);
    model.setField(0, "Sprite", "width", undefined);
    expect("width" in model.data.entities[0].components.Sprite).toBe(false);
  });

  it("setField rejects a value of the wrong kind", () => {
    const { model } = setup();
    expect(() => model.setField(1, "Rect", "width", "big")).toThrow(
      "Rect.width must be a number",
    );
    expect(() => model.setField(1, "Rect", "width", undefined)).toThrow(
      "Rect.width must be a number",
    );
  });

  it("setField rejects an unknown field, or a component the entity does not have", () => {
    const { model } = setup();
    expect(() => model.setField(1, "Rect", "depth", 1)).toThrow('Rect has no field "depth"');
    expect(() => model.setField(1, "Rect", "toString", 1)).toThrow(
      'Rect has no field "toString"',
    );
    expect(() => model.setField(0, "Rect", "width", 1)).toThrow("Entity 0 has no Rect");
  });
});

describe("moving", () => {
  it("move sets the Transform to whole pixels and saves", () => {
    const { model, stored } = setup();
    model.move(0, 10.6, 20.2);
    expect(model.data.entities[0].components.Transform).toEqual({ x: 11, y: 20 });
    expect(stored().entities[0].components.Transform).toEqual({ x: 11, y: 20 });
  });

  it("move without saving still updates the views", () => {
    const { model, stored, changes } = setup();
    model.move(0, 5, 5, false);
    expect(model.data.entities[0].components.Transform).toEqual({ x: 5, y: 5 });
    expect(changes()).toBe(1);
    expect(stored()).toBeNull();
  });

  it("move gives an entity without a Transform one", () => {
    const { model } = setup();
    model.move(1, 3, 4);
    expect(model.data.entities[1].components.Transform).toEqual({ x: 3, y: 4 });
  });
});

describe("saving problems", () => {
  it("a failed save is reported and the edit is kept", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("Quota exceeded");
    };
    const { model } = setup({}, storage);
    model.rename(0, "Player");
    expect(model.status).toEqual({ error: "Quota exceeded" });
    expect(names(model)).toEqual(["Player", "Box"]);
  });

  it("without browser storage, edits are kept in memory and reported as not saved", () => {
    const { model } = setup({}, null);
    model.addEntity();
    expect(model.status).toEqual({ error: "Browser storage is not available" });
    expect(names(model)).toHaveLength(3);
  });
});

describe("load errors and reset", () => {
  it("a broken saved copy is reported, and the default is shown meanwhile", () => {
    const { model } = setup({ main: "{oops" });
    expect(model.loadError).toMatch(/^Scene "main": Scene data is not valid JSON/);
    expect(names(model)).toEqual(["Hero", "Box"]);
    expect(model.status).toBe("default");
  });

  it("a broken scene cannot be edited until it is reset", () => {
    const { model, stored } = setup({ main: "{oops" });
    const blocked = 'Scene "main" could not be loaded; reset it to edit it';
    expect(() => model.rename(0, "x")).toThrow(blocked);
    expect(() => model.addEntity()).toThrow(blocked);
    expect(() => model.move(0, 1, 1)).toThrow(blocked);
    model.resetScene();
    expect(model.loadError).toBeNull();
    expect(stored()).toBeNull();
    model.rename(0, "x");
    expect(names(model)).toEqual(["x", "Box"]);
  });

  it("resetScene deletes the saved copy and brings back the untouched default", () => {
    const { model, stored, changes } = setup();
    model.rename(0, "Changed");
    model.setField(0, "Transform", "x", 99);
    model.select(0);
    model.resetScene();
    expect(names(model)).toEqual(["Hero", "Box"]);
    expect(model.data.entities[0].components.Transform).toEqual({ x: 10, y: 20 });
    expect(stored()).toBeNull();
    expect(model.status).toBe("default");
    expect(model.selected).toBeNull();
    expect(changes()).toBe(4);
  });

  it("a failed reset is reported", () => {
    const { model } = setup({}, null);
    model.resetScene();
    expect(model.status).toEqual({ error: "Browser storage is not available" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/editor/model.test.ts`
Expected: FAIL — `../../src/editor/model` cannot be resolved.

- [ ] **Step 3: Implement the model**

Create `src/editor/model.ts`:

```ts
import {
  ComponentRegistry,
  describeKind,
  fitsKind,
  parseSceneData,
  validateSceneData,
  type EntityData,
  type GameDefinition,
  type SceneData,
  type SceneStore,
} from "../engine";

/** Whether the current scene is saved. A failed save keeps the edit in memory. */
export type SaveStatus = "saved" | "default" | { error: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The scene being edited, the selection, and every change to them. Each change is saved. */
export class EditorModel {
  readonly registry: ComponentRegistry;
  private sceneName = "";
  private sceneData: SceneData = { version: 1, entities: [] };
  private selection: number | null = null;
  private saveStatus: SaveStatus = "default";
  private error: string | null = null;
  private readonly listeners: (() => void)[] = [];

  constructor(
    readonly definition: GameDefinition,
    private readonly store: SceneStore,
  ) {
    this.registry = new ComponentRegistry(definition.components);
    this.load(definition.firstScene);
  }

  get scene(): string {
    return this.sceneName;
  }

  get data(): SceneData {
    return this.sceneData;
  }

  /** Index into data.entities, or null. */
  get selected(): number | null {
    return this.selection;
  }

  get status(): SaveStatus {
    return this.saveStatus;
  }

  /** Set when the scene's saved copy could not be loaded; editing waits for a reset. */
  get loadError(): string | null {
    return this.error;
  }

  get sceneNames(): string[] {
    return Object.keys(this.definition.scenes);
  }

  get imageNames(): string[] {
    return Object.keys(this.definition.images);
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  openScene(name: string): void {
    this.load(name);
    this.notify();
  }

  select(index: number | null): void {
    if (index !== null) this.entity(index);
    this.selection = index;
    this.notify();
  }

  /** Appends "Entity N" with a Transform at the center of the scene, and selects it. */
  addEntity(): void {
    this.checkEditable();
    const used = new Set(this.sceneData.entities.map((entity) => entity.name));
    let n = 1;
    while (used.has(`Entity ${n}`)) n++;
    const x = Math.round(this.definition.width / 2);
    const y = Math.round(this.definition.height / 2);
    this.sceneData.entities.push({ name: `Entity ${n}`, components: { Transform: { x, y } } });
    this.selection = this.sceneData.entities.length - 1;
    this.save();
  }

  removeEntity(index: number): void {
    this.editableEntity(index);
    this.sceneData.entities.splice(index, 1);
    if (this.selection === index) this.selection = null;
    else if (this.selection !== null && this.selection > index) this.selection--;
    this.save();
  }

  rename(index: number, name: string): void {
    this.editableEntity(index).name = name;
    this.save();
  }

  /** Adds a component with its constructor defaults; an empty image field gets the first image. */
  addComponent(index: number, name: string): void {
    const entity = this.editableEntity(index);
    const definition = this.registry.get(name);
    if (!definition) throw new Error(`Unknown component "${name}"`);
    if (Object.hasOwn(entity.components, name)) {
      throw new Error(`Entity ${index} already has ${name}`);
    }
    const instance = new definition.type() as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const [field, kind] of Object.entries(definition.fields)) {
      let value = instance[field];
      if (kind === "image" && value === "") value = this.imageNames[0] ?? "";
      if (value !== undefined) fields[field] = value;
    }
    entity.components[name] = fields;
    this.save();
  }

  removeComponent(index: number, name: string): void {
    this.componentFields(index, name);
    delete this.sceneData.entities[index].components[name];
    this.save();
  }

  /** Sets a field; `undefined` empties an optional number. */
  setField(index: number, name: string, field: string, value: unknown): void {
    const fields = this.componentFields(index, name);
    const definition = this.registry.get(name);
    if (!definition || !Object.hasOwn(definition.fields, field)) {
      throw new Error(`${name} has no field "${field}"`);
    }
    const kind = definition.fields[field];
    if (value === undefined && kind === "optionalNumber") {
      delete fields[field];
    } else if (fitsKind(kind, value)) {
      fields[field] = value;
    } else {
      throw new Error(`${name}.${field} must be ${describeKind(kind)}`);
    }
    this.save();
  }

  /** Moves an entity to whole pixels. A drag passes `save = false` until it ends. */
  move(index: number, x: number, y: number, save = true): void {
    const entity = this.editableEntity(index);
    const transform = (entity.components.Transform ??= {});
    transform.x = Math.round(x);
    transform.y = Math.round(y);
    if (save) this.save();
    else this.notify();
  }

  /** Deletes the saved copy and goes back to the scene's default data. */
  resetScene(): void {
    let failure: string | null = null;
    try {
      this.store.reset(this.sceneName);
    } catch (error) {
      failure = messageOf(error);
    }
    this.load(this.sceneName);
    if (failure !== null) this.saveStatus = { error: failure };
    this.notify();
  }

  private load(name: string): void {
    const entry = Object.hasOwn(this.definition.scenes, name)
      ? this.definition.scenes[name]
      : undefined;
    if (!entry) throw new Error(`Scene "${name}" not found`);
    let fallback: SceneData;
    try {
      // A fresh copy, so edits never change the imported default.
      fallback = validateSceneData(entry.data, this.registry);
    } catch (error) {
      throw new Error(`Scene "${name}": ${messageOf(error)}`, { cause: error });
    }
    this.sceneName = name;
    this.sceneData = fallback;
    this.selection = null;
    this.saveStatus = "default";
    this.error = null;
    try {
      const saved = this.store.load(name);
      if (saved === null) return;
      this.sceneData = parseSceneData(saved, this.registry);
      this.saveStatus = "saved";
    } catch (error) {
      this.error = `Scene "${name}": ${messageOf(error)}`;
    }
  }

  private save(): void {
    try {
      this.store.save(this.sceneName, this.sceneData);
      this.saveStatus = "saved";
    } catch (error) {
      this.saveStatus = { error: messageOf(error) };
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private entity(index: number): EntityData {
    const entity = Number.isInteger(index) ? this.sceneData.entities[index] : undefined;
    if (!entity) throw new Error(`No entity at index ${index}`);
    return entity;
  }

  private checkEditable(): void {
    if (this.error !== null) {
      throw new Error(`Scene "${this.sceneName}" could not be loaded; reset it to edit it`);
    }
  }

  private editableEntity(index: number): EntityData {
    this.checkEditable();
    return this.entity(index);
  }

  private componentFields(index: number, name: string): Record<string, unknown> {
    const entity = this.editableEntity(index);
    if (!Object.hasOwn(entity.components, name)) throw new Error(`Entity ${index} has no ${name}`);
    return entity.components[name];
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/editor/model.test.ts`
Expected: PASS, all tests.

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/editor/model.ts tests/editor/model.test.ts
git commit -m "feat: editor model for adding, removing, editing and moving entities"
```

---

### Task 7: Hit testing

**Files:**
- Create: `src/editor/hit-test.ts`
- Test: `tests/editor/hit-test.test.ts`

**Interfaces:**
- Consumes (from `src/engine/index.ts`): `Assets`, `Layer`, `Rect`, `Sprite`, `Text`, `Transform`, `World`, `type Entity`.
- Produces:
  - `interface Box { x: number; y: number; width: number; height: number }`
  - `type MeasureText = (text: Text) => number`
  - `const MARKER_SIZE = 9`
  - `hasDrawable(world: World, entity: Entity): boolean`
  - `entityBox(world: World, entity: Entity, assets: Assets, measure: MeasureText): Box | null`
  - `hitTest(world: World, point: { x: number; y: number }, assets: Assets, measure: MeasureText): Entity | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/editor/hit-test.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { entityBox, hasDrawable, hitTest, MARKER_SIZE } from "../../src/editor/hit-test";
import { Assets, Layer, Rect, Sprite, Text, Transform, World, type Entity } from "../../src/engine";

async function setup() {
  const world = new World();
  const assets = new Assets(
    async (url) =>
      (url === "/sheet.png" ? { width: 64, height: 32 } : { width: 50, height: 40 }) as HTMLImageElement,
  );
  await assets.loadImages({
    bg: "/bg.png",
    sheet: { url: "/sheet.png", frameWidth: 16, frameHeight: 16 },
  });
  const spawn = (...components: object[]) => {
    const entity = world.spawn();
    for (const component of components) world.add(entity, component);
    return entity;
  };
  /** Pretends every character is 10px wide. */
  const measure = (text: Text) => text.value.length * 10;
  const box = (entity: Entity) => entityBox(world, entity, assets, measure);
  const hit = (x: number, y: number) => hitTest(world, { x, y }, assets, measure);
  return { world, spawn, box, hit };
}

describe("entityBox", () => {
  it("uses a Rect's size at the Transform", async () => {
    const { spawn, box } = await setup();
    const e = spawn(new Transform(10, 20), new Rect(30, 40));
    expect(box(e)).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it("uses a Sprite's natural size, its frame's size, or its own size", async () => {
    const { spawn, box } = await setup();
    expect(box(spawn(new Transform(), new Sprite("bg")))).toMatchObject({ width: 50, height: 40 });
    expect(box(spawn(new Transform(), new Sprite("sheet", { frame: 5 })))).toMatchObject({
      width: 16,
      height: 16,
    });
    const sized = spawn(new Transform(), new Sprite("sheet", { width: 32, height: 48, flipX: true }));
    expect(box(sized)).toMatchObject({ width: 32, height: 48 });
  });

  it("places a Text box by its alignment, with the font size as its height", async () => {
    const { spawn, box } = await setup();
    const at = new Transform(100, 50);
    expect(box(spawn(at, new Text("abc", { size: 20 })))).toEqual({
      x: 100,
      y: 50,
      width: 30,
      height: 20,
    });
    expect(box(spawn(at, new Text("abc", { size: 20, align: "center" })))?.x).toBe(85);
    expect(box(spawn(at, new Text("abc", { size: 20, align: "right" })))?.x).toBe(70);
  });

  it("covers everything an entity draws", async () => {
    const { spawn, box } = await setup();
    const e = spawn(new Transform(0, 0), new Rect(10, 10), new Text("abcdef", { size: 5 }));
    expect(box(e)).toEqual({ x: 0, y: 0, width: 60, height: 10 });
  });

  it("gives an entity with nothing to draw a marker box centered on its Transform", async () => {
    const { spawn, box } = await setup();
    const half = MARKER_SIZE / 2;
    expect(box(spawn(new Transform(10, 10)))).toEqual({
      x: 10 - half,
      y: 10 - half,
      width: MARKER_SIZE,
      height: MARKER_SIZE,
    });
  });

  it("uses the marker box for a sprite that cannot be drawn", async () => {
    const { spawn, box } = await setup();
    expect(box(spawn(new Transform(10, 10), new Sprite("missing")))?.width).toBe(MARKER_SIZE);
    expect(box(spawn(new Transform(10, 10), new Sprite("sheet", { frame: 99 })))?.width).toBe(
      MARKER_SIZE,
    );
  });

  it("has no box without a Transform", async () => {
    const { spawn, box } = await setup();
    expect(box(spawn(new Rect(10, 10)))).toBeNull();
  });
});

describe("hasDrawable", () => {
  it("is true for a Rect, Sprite or Text, and false otherwise", async () => {
    const { world, spawn } = await setup();
    expect(hasDrawable(world, spawn(new Transform(), new Rect()))).toBe(true);
    expect(hasDrawable(world, spawn(new Transform(), new Sprite("bg")))).toBe(true);
    expect(hasDrawable(world, spawn(new Transform(), new Text("a")))).toBe(true);
    expect(hasDrawable(world, spawn(new Transform(), new Layer(2)))).toBe(false);
  });
});

describe("hitTest", () => {
  it("finds the entity under the point, or null over empty space", async () => {
    const { spawn, hit } = await setup();
    const e = spawn(new Transform(10, 10), new Rect(20, 20));
    expect(hit(15, 15)).toBe(e);
    expect(hit(50, 50)).toBeNull();
  });

  it("includes the left and top edges but not the right and bottom ones", async () => {
    const { spawn, hit } = await setup();
    const e = spawn(new Transform(10, 10), new Rect(20, 20));
    expect(hit(10, 10)).toBe(e);
    expect(hit(30, 15)).toBeNull();
    expect(hit(15, 30)).toBeNull();
  });

  it("picks the higher layer, even when it was spawned first", async () => {
    const { spawn, hit } = await setup();
    const top = spawn(new Transform(0, 0), new Rect(20, 20), new Layer(1));
    spawn(new Transform(0, 0), new Rect(20, 20));
    expect(hit(5, 5)).toBe(top);
  });

  it("on the same layer, picks the entity spawned last", async () => {
    const { spawn, hit } = await setup();
    spawn(new Transform(0, 0), new Rect(20, 20));
    const last = spawn(new Transform(0, 0), new Rect(20, 20));
    expect(hit(5, 5)).toBe(last);
  });

  it("can pick an entity by its marker", async () => {
    const { spawn, hit } = await setup();
    const e = spawn(new Transform(50, 50));
    expect(hit(52, 48)).toBe(e);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/editor/hit-test.test.ts`
Expected: FAIL — `../../src/editor/hit-test` cannot be resolved.

- [ ] **Step 3: Implement hit testing**

Create `src/editor/hit-test.ts`:

```ts
import {
  Layer,
  Rect,
  Sprite,
  Text,
  Transform,
  type Assets,
  type Entity,
  type World,
} from "../engine";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Measures a Text's width in pixels (the canvas's measureText in the browser). */
export type MeasureText = (text: Text) => number;

/** Size of the cross drawn for an entity that has nothing else to draw. */
export const MARKER_SIZE = 9;

export function hasDrawable(world: World, entity: Entity): boolean {
  return world.has(entity, Rect) || world.has(entity, Sprite) || world.has(entity, Text);
}

/** The area an entity covers on screen: everything it draws, or its marker. Null without a Transform. */
export function entityBox(
  world: World,
  entity: Entity,
  assets: Assets,
  measure: MeasureText,
): Box | null {
  const transform = world.get(entity, Transform);
  if (!transform) return null;
  const { x, y } = transform;
  const boxes: Box[] = [];

  const rect = world.get(entity, Rect);
  if (rect) boxes.push({ x, y, width: rect.width, height: rect.height });

  const sprite = world.get(entity, Sprite);
  if (sprite && canDraw(assets, sprite)) {
    const { sw, sh } = assets.getFrame(sprite.image, sprite.frame);
    boxes.push({ x, y, width: sprite.width ?? sw, height: sprite.height ?? sh });
  }

  const text = world.get(entity, Text);
  if (text) {
    const width = measure(text);
    const left = text.align === "center" ? x - width / 2 : text.align === "right" ? x - width : x;
    boxes.push({ x: left, y, width, height: text.size });
  }

  if (boxes.length === 0) {
    const half = MARKER_SIZE / 2;
    return { x: x - half, y: y - half, width: MARKER_SIZE, height: MARKER_SIZE };
  }
  return union(boxes);
}

/** The top-most entity whose box contains the point, in the renderer's order. */
export function hitTest(
  world: World,
  point: { x: number; y: number },
  assets: Assets,
  measure: MeasureText,
): Entity | null {
  const entities = world.query(Transform).map(([entity]) => entity);
  // Drawn last = on top: highest layer, then latest spawned.
  entities.sort((a, b) => layerOf(world, b) - layerOf(world, a) || b - a);
  for (const entity of entities) {
    const box = entityBox(world, entity, assets, measure);
    if (
      box &&
      point.x >= box.x &&
      point.x < box.x + box.width &&
      point.y >= box.y &&
      point.y < box.y + box.height
    ) {
      return entity;
    }
  }
  return null;
}

function layerOf(world: World, entity: Entity): number {
  return world.get(entity, Layer)?.value ?? 0;
}

function canDraw(assets: Assets, sprite: Sprite): boolean {
  if (!assets.hasImage(sprite.image)) return false;
  const { frame } = sprite;
  return Number.isInteger(frame) && frame >= 0 && frame < assets.frameCount(sprite.image);
}

function union(boxes: Box[]): Box {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/editor/hit-test.test.ts`
Expected: PASS, all tests.

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/editor/hit-test.ts tests/editor/hit-test.test.ts
git commit -m "feat: editor hit testing in the renderer's order"
```

---

### Task 8: Editor page — shell, top bar and viewport

The DOM views have no unit tests (Vitest runs in Node, with no DOM). They stay thin, and are verified by typecheck, the build and the browser check in Step 6.

**Files:**
- Create: `vite.config.ts`
- Create: `editor.html`
- Create: `src/editor/main.ts`
- Create: `src/editor/views/top-bar.ts`
- Create: `src/editor/views/viewport.ts`
- Modify: `src/engine/index.ts` (export `render`)

**Interfaces:**
- Consumes: `EditorModel`, `SaveStatus` (Task 6); `entityBox`, `hasDrawable`, `hitTest`, `MARKER_SIZE` (Task 7); `definition` (Task 5); `Assets`, `Canvas`, `World`, `Text`, `Transform`, `render`, `spawnSceneData`, `browserSceneStore` (engine).
- Produces:
  - `mountTopBar(root: HTMLElement, model: EditorModel): void`
  - `mountViewport(element: HTMLCanvasElement, model: EditorModel, assets: Assets): void`
  - `editor.html` with `#topbar`, `#entities`, `#view` > `canvas#viewport`, `#inspector`
  - `render` exported from `src/engine/index.ts`

- [ ] **Step 1: Build both pages**

Create `vite.config.ts`:

```ts
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        editor: resolve(import.meta.dirname, "editor.html"),
      },
    },
  },
});
```

In `src/engine/index.ts`, add after the `Canvas` line:

```ts
export { render } from "./render/systems";
```

- [ ] **Step 2: Write the page**

Create `editor.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Scene Editor</title>
    <style>
      :root {
        color-scheme: dark;
        font: 13px system-ui, sans-serif;
      }
      html,
      body {
        margin: 0;
        height: 100%;
        background: #111;
        color: #e5e7eb;
      }
      body {
        display: grid;
        grid-template: "top top top" auto "list view inspector" 1fr / 200px 1fr 280px;
      }
      #topbar {
        grid-area: top;
        display: flex;
        gap: 8px;
        align-items: center;
        padding: 8px;
        background: #1f2937;
      }
      #entities {
        grid-area: list;
        overflow: auto;
        padding: 8px;
        background: #18181b;
      }
      #view {
        grid-area: view;
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }
      #inspector {
        grid-area: inspector;
        overflow: auto;
        padding: 8px;
        background: #18181b;
      }
      canvas {
        background: #222;
        max-width: 100%;
        max-height: 100%;
        touch-action: none;
      }
      ul {
        list-style: none;
        margin: 8px 0;
        padding: 0;
      }
      li {
        padding: 4px 6px;
        border-radius: 3px;
        cursor: pointer;
      }
      li:hover {
        background: #27272a;
      }
      li.selected {
        background: #2563eb;
      }
      .status.error {
        color: #f87171;
      }
      section.component {
        border-top: 1px solid #333;
        padding: 6px 0;
      }
      section.component h3 {
        display: flex;
        justify-content: space-between;
        margin: 4px 0;
        font-size: 13px;
      }
      label.row {
        display: grid;
        grid-template-columns: 80px 1fr;
        gap: 6px;
        align-items: center;
        margin: 3px 0;
      }
      input,
      select,
      button {
        font: inherit;
      }
      input[type="text"],
      input[type="number"],
      select {
        min-width: 0;
      }
      .color {
        display: flex;
        gap: 4px;
      }
      .color input[type="text"] {
        flex: 1;
      }
    </style>
  </head>
  <body>
    <header id="topbar"></header>
    <aside id="entities"></aside>
    <main id="view"><canvas id="viewport"></canvas></main>
    <aside id="inspector"></aside>
    <script type="module" src="/src/editor/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Write the top bar**

Create `src/editor/views/top-bar.ts`:

```ts
import type { EditorModel, SaveStatus } from "../model";

function statusText(status: SaveStatus): string {
  if (status === "saved") return "Saved";
  if (status === "default") return "Default (not edited)";
  return `Not saved: ${status.error}`;
}

/** Scene picker, Play, Reset to default, and the save status. */
export function mountTopBar(root: HTMLElement, model: EditorModel): void {
  const scenes = document.createElement("select");
  for (const name of model.sceneNames) scenes.append(new Option(name, name));
  scenes.addEventListener("change", () => model.openScene(scenes.value));

  const play = document.createElement("button");
  play.textContent = "Play";
  play.addEventListener("click", () => window.open("/", "_blank"));

  const reset = document.createElement("button");
  reset.textContent = "Reset to default";
  reset.addEventListener("click", () => model.resetScene());

  const status = document.createElement("span");
  status.className = "status";

  root.replaceChildren(scenes, play, reset, status);

  const update = () => {
    scenes.value = model.scene;
    status.textContent = statusText(model.status);
    status.classList.toggle("error", typeof model.status === "object");
  };
  model.onChange(update);
  update();
}
```

- [ ] **Step 4: Write the viewport**

Create `src/editor/views/viewport.ts`:

```ts
import {
  Canvas,
  render,
  spawnSceneData,
  Transform,
  World,
  type Assets,
  type Entity,
  type Text,
} from "../../engine";
import { entityBox, hasDrawable, hitTest, MARKER_SIZE } from "../hit-test";
import type { EditorModel } from "../model";

interface Drag {
  index: number;
  /** Pointer position at the press, in scene pixels. */
  startX: number;
  startY: number;
  /** The entity's position at the press. */
  fromX: number;
  fromY: number;
  moved: boolean;
}

/** Draws the scene with the engine's renderer; click selects, drag moves. */
export function mountViewport(element: HTMLCanvasElement, model: EditorModel, assets: Assets): void {
  const { width, height, pixelArt } = model.definition;
  const canvas = new Canvas(element, width, height);
  const { ctx } = canvas;
  ctx.imageSmoothingEnabled = !pixelArt;

  const measure = (text: Text) => {
    ctx.font = `${text.size}px ${text.font}`;
    return ctx.measureText(text.value).width;
  };

  let world = new World();
  /** entities[i] is the entity spawned for data.entities[i]. */
  let entities: Entity[] = [];
  let drag: Drag | null = null;

  const drawOverlay = () => {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#facc15";
    const half = MARKER_SIZE / 2;
    for (const entity of entities) {
      const transform = world.get(entity, Transform);
      if (!transform || hasDrawable(world, entity)) continue;
      ctx.beginPath();
      ctx.moveTo(transform.x - half, transform.y);
      ctx.lineTo(transform.x + half, transform.y);
      ctx.moveTo(transform.x, transform.y - half);
      ctx.lineTo(transform.x, transform.y + half);
      ctx.stroke();
    }
    const selected = model.selected === null ? undefined : entities[model.selected];
    const box = selected === undefined ? null : entityBox(world, selected, assets, measure);
    if (box) {
      ctx.strokeStyle = "#38bdf8";
      ctx.strokeRect(box.x - 0.5, box.y - 0.5, box.width + 1, box.height + 1);
    }
    ctx.restore();
  };

  const draw = () => {
    world = new World();
    world.setResource(canvas);
    world.setResource(assets);
    entities = [];
    if (model.loadError) {
      drawMessage(ctx, width, height, model.loadError);
      return;
    }
    try {
      entities = spawnSceneData(world, model.data, model.registry);
      render(world);
      drawOverlay();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      drawMessage(ctx, width, height, `Cannot draw this scene: ${message}`);
    }
  };

  /** Pointer position in scene pixels, whatever size CSS shows the canvas at. */
  const toScene = (event: PointerEvent) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * width) / bounds.width,
      y: ((event.clientY - bounds.top) * height) / bounds.height,
    };
  };

  element.addEventListener("pointerdown", (event) => {
    if (model.loadError) return;
    const point = toScene(event);
    const hit = hitTest(world, point, assets, measure);
    const index = hit === null ? -1 : entities.indexOf(hit);
    model.select(index === -1 ? null : index);
    if (index === -1) return;
    const transform = model.data.entities[index].components.Transform ?? {};
    drag = {
      index,
      startX: point.x,
      startY: point.y,
      fromX: typeof transform.x === "number" ? transform.x : 0,
      fromY: typeof transform.y === "number" ? transform.y : 0,
      moved: false,
    };
    element.setPointerCapture(event.pointerId);
  });

  element.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const point = toScene(event);
    drag.moved = true;
    model.move(
      drag.index,
      drag.fromX + point.x - drag.startX,
      drag.fromY + point.y - drag.startY,
      false,
    );
  });

  const endDrag = () => {
    if (drag?.moved) {
      // Moves during the drag were not saved; save the final position once.
      const transform = model.data.entities[drag.index].components.Transform;
      model.move(drag.index, Number(transform.x), Number(transform.y));
    }
    drag = null;
  };
  element.addEventListener("pointerup", endDrag);
  element.addEventListener("pointercancel", endDrag);

  model.onChange(draw);
  draw();
}

/** Clears the canvas and shows a message, wrapped to fit. */
function drawMessage(ctx: CanvasRenderingContext2D, width: number, height: number, text: string) {
  const charsPerLine = Math.max(1, Math.floor((width - 32) / 9));
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.fillStyle = "#f87171";
  ctx.font = "16px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i * charsPerLine < text.length; i++) {
    ctx.fillText(text.slice(i * charsPerLine, (i + 1) * charsPerLine), 16, 16 + i * 22);
  }
  ctx.restore();
}
```

Create `src/editor/main.ts`:

```ts
import { Assets, browserSceneStore } from "../engine";
import { definition } from "../game/definition";
import { EditorModel } from "./model";
import { mountTopBar } from "./views/top-bar";
import { mountViewport } from "./views/viewport";

function element<T extends HTMLElement>(selector: string, type: new () => T): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Editor element not found: ${selector}`);
  return found;
}

const model = new EditorModel(definition, browserSceneStore());
const assets = new Assets();
try {
  await assets.loadImages(definition.images);
} catch (error) {
  document.body.textContent = `Failed to load images: ${
    error instanceof Error ? error.message : String(error)
  }`;
  throw error;
}

mountTopBar(element("#topbar", HTMLElement), model);
mountViewport(element("#viewport", HTMLCanvasElement), model, assets);
```

- [ ] **Step 5: Verify the project**

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds, and `dist/` contains both `index.html` and `editor.html` (check with `ls dist`).

- [ ] **Step 6: Check in the browser**

Start `npx vite --port 5173 --strictPort` in the background, call `tabs_context_mcp`, and navigate a tab to `http://localhost:5173/editor.html`. The editor draws on demand, without requestAnimationFrame, so a hidden tab is fine. In the JavaScript you run, clear the saved scenes first with `localStorage.clear()`, then reload.

1. Screenshot. Expected: the top bar (scene dropdown on `title`, Play, Reset to default, "Default (not edited)") and the title scene drawn in the viewport.
2. Choose `play` in the dropdown. Expected: the background, the hero in the middle, the hint at top left, and no rects (they come from code).
3. Click the hero. Expected: a blue outline around it.
4. Drag the hero about 100px right (`left_click_drag`). Expected: the hero follows the drag and the status shows "Saved". `localStorage.getItem("browser-engine:scene:play")` has the new x.
5. Resize the window narrower (`resize_window`, e.g. 900×700) so the canvas is scaled down. Drag the hero again. Expected: it stays under the pointer.
6. Reload. Expected: the hero is where it was dropped.
7. Click Reset to default. Expected: the hero is back in the middle, and the status shows "Default (not edited)".
8. Run `localStorage.setItem("browser-engine:scene:play", "{oops")`, then reload and pick `play`. Expected: the viewport shows `Scene "play": Scene data is not valid JSON…`. Then Reset to default brings the scene back.

Leave the dev server running for Task 9, or stop it as usual (PowerShell `Get-CimInstance Win32_Process` filtered on `vite`) and confirm port 5173 is free.

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts editor.html src/editor src/engine/index.ts
git commit -m "feat: editor page with scene picker, save status and a draggable viewport"
```

---

### Task 9: Editor page — entity list and inspector

**Files:**
- Create: `src/editor/views/entity-list.ts`
- Create: `src/editor/views/inspector.ts`
- Modify: `src/editor/main.ts`

**Interfaces:**
- Consumes: `EditorModel` (Task 6); `FieldKind` (engine); the `#entities` and `#inspector` elements (Task 8).
- Produces:
  - `mountEntityList(root: HTMLElement, model: EditorModel): void`
  - `mountInspector(root: HTMLElement, model: EditorModel): void`
  - The Delete key removes the selected entity unless focus is in an input, select or textarea.

- [ ] **Step 1: Write the entity list**

Create `src/editor/views/entity-list.ts`:

```ts
import type { EditorModel } from "../model";

/** The scene's entities by name, with Add and Remove. */
export function mountEntityList(root: HTMLElement, model: EditorModel): void {
  const update = () => {
    root.replaceChildren();
    if (model.loadError) return;

    const add = document.createElement("button");
    add.textContent = "+ Add entity";
    add.addEventListener("click", () => model.addEntity());

    const list = document.createElement("ul");
    model.data.entities.forEach((entity, index) => {
      const item = document.createElement("li");
      item.textContent = entity.name || "(unnamed)";
      item.classList.toggle("selected", index === model.selected);
      item.addEventListener("click", () => model.select(index));
      list.append(item);
    });

    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.disabled = model.selected === null;
    remove.addEventListener("click", () => {
      if (model.selected !== null) model.removeEntity(model.selected);
    });

    root.append(add, list, remove);
  };
  model.onChange(update);
  update();
}
```

- [ ] **Step 2: Write the inspector**

Create `src/editor/views/inspector.ts`:

```ts
import type { FieldKind } from "../../engine";
import type { EditorModel } from "../model";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * The selected entity's name and components, one input per registered field.
 * It is rebuilt only when the selection or the component list changes. Otherwise
 * values are refreshed in place, skipping the focused input, so typing keeps focus.
 */
export function mountInspector(root: HTMLElement, model: EditorModel): void {
  let shape = "";
  const update = () => {
    const next = shapeOf(model);
    if (next !== shape) {
      shape = next;
      build(root, model);
    }
    refresh(root, model);
  };
  model.onChange(update);
  update();
}

function shapeOf(model: EditorModel): string {
  const index = model.selected;
  if (index === null || model.loadError) return "none";
  const components = Object.keys(model.data.entities[index].components);
  return JSON.stringify([model.scene, index, components]);
}

function build(root: HTMLElement, model: EditorModel): void {
  root.replaceChildren();
  const index = model.selected;
  if (index === null || model.loadError) return;
  const entity = model.data.entities[index];

  const name = document.createElement("input");
  name.type = "text";
  name.dataset.name = "";
  name.addEventListener("input", () => model.rename(index, name.value));
  root.append(row("Name", name));

  for (const componentName of Object.keys(entity.components)) {
    const definition = model.registry.get(componentName);
    if (!definition) continue;
    const section = document.createElement("section");
    section.className = "component";

    const title = document.createElement("h3");
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.title = `Remove ${componentName}`;
    remove.addEventListener("click", () => model.removeComponent(index, componentName));
    title.append(componentName, remove);
    section.append(title);

    for (const [field, kind] of Object.entries(definition.fields)) {
      section.append(row(field, fieldInput(model, index, componentName, field, kind)));
    }
    root.append(section);
  }

  const add = document.createElement("select");
  add.append(new Option("+ Add component", ""));
  for (const definition of model.registry.all()) {
    if (!Object.hasOwn(entity.components, definition.name)) {
      add.append(new Option(definition.name, definition.name));
    }
  }
  add.addEventListener("change", () => {
    if (add.value) model.addComponent(index, add.value);
  });
  root.append(add);
}

function row(label: string, input: HTMLElement): HTMLLabelElement {
  const element = document.createElement("label");
  element.className = "row";
  const text = document.createElement("span");
  text.textContent = label;
  element.append(text, input);
  return element;
}

/** Marks an input with the field it shows, for refresh(). */
function bind<T extends HTMLElement>(input: T, component: string, field: string): T {
  input.dataset.component = component;
  input.dataset.field = field;
  return input;
}

function fieldInput(
  model: EditorModel,
  index: number,
  component: string,
  field: string,
  kind: FieldKind,
): HTMLElement {
  const set = (value: unknown) => model.setField(index, component, field, value);

  if (typeof kind === "object" || kind === "image") {
    const select = bind(document.createElement("select"), component, field);
    const options = typeof kind === "object" ? kind.choice : model.imageNames;
    for (const option of options) select.append(new Option(option, option));
    select.addEventListener("change", () => set(select.value));
    return select;
  }

  const input = bind(document.createElement("input"), component, field);
  switch (kind) {
    case "number":
    case "optionalNumber":
      input.type = "number";
      input.addEventListener("input", () => {
        if (input.value === "") {
          if (kind === "optionalNumber") set(undefined);
          return;
        }
        if (Number.isFinite(input.valueAsNumber)) set(input.valueAsNumber);
      });
      return input;
    case "boolean":
      input.type = "checkbox";
      input.addEventListener("change", () => set(input.checked));
      return input;
    case "string":
      input.type = "text";
      input.addEventListener("input", () => set(input.value));
      return input;
    case "color": {
      input.type = "text";
      input.addEventListener("input", () => set(input.value));
      const picker = document.createElement("input");
      picker.type = "color";
      picker.dataset.picker = "";
      bind(picker, component, field);
      picker.addEventListener("input", () => set(picker.value));
      const wrapper = document.createElement("span");
      wrapper.className = "color";
      wrapper.append(input, picker);
      return wrapper;
    }
  }
}

/** Copies the model's values into the inputs, leaving the focused one alone. */
function refresh(root: HTMLElement, model: EditorModel): void {
  const index = model.selected;
  if (index === null || model.loadError) return;
  const entity = model.data.entities[index];

  const name = root.querySelector<HTMLInputElement>("input[data-name]");
  if (name && name !== document.activeElement) name.value = entity.name;

  for (const input of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    "[data-field]",
  )) {
    if (input === document.activeElement) continue;
    const { component = "", field = "" } = input.dataset;
    const value = entity.components[component]?.[field];
    if (input instanceof HTMLInputElement && input.type === "checkbox") {
      input.checked = value === true;
    } else if (input instanceof HTMLInputElement && "picker" in input.dataset) {
      if (typeof value === "string" && HEX_COLOR.test(value)) input.value = value;
    } else {
      input.value = value === undefined ? "" : String(value);
    }
  }
}
```

- [ ] **Step 3: Mount them and wire the Delete key**

In `src/editor/main.ts`, add the imports:

```ts
import { mountEntityList } from "./views/entity-list";
import { mountInspector } from "./views/inspector";
```

and append at the end of the file:

```ts
mountEntityList(element("#entities", HTMLElement), model);
mountInspector(element("#inspector", HTMLElement), model);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Delete" || model.selected === null || model.loadError) return;
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  model.removeEntity(model.selected);
});
```

- [ ] **Step 4: Verify the project**

Run: `npm test`
Expected: PASS, all test files.

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Check the success-criteria flow in the browser**

With the dev server running (start it as in Task 8 if needed), open `http://localhost:5173/editor.html` and run `localStorage.clear()` followed by a reload. Then, on the `play` scene:

1. Click **+ Add entity**. Expected: "Entity 1" is in the list and selected; a yellow cross is drawn at the center; the inspector shows Name and Transform x 400, y 300.
2. Click the Name field, select its text and type `Box`. Expected: the list shows "Box" after each key, and the field keeps focus the whole time (the typed text is complete).
3. Use **+ Add component** → `Rect`. Expected: a white 32×32 square at the center, and the cross disappears.
4. Type `red` into Rect's color text field. Expected: the square turns red.
5. Drag the square. Expected: Transform x/y in the inspector follow the drag.
6. Click × on Rect. Expected: the square is gone and the cross is back. Then add the Rect again.
7. Click "Hint" in the list, then press Delete (focus is not in a field). Expected: Hint is removed from the list and the viewport.
8. Click **Play**. In the new tab, take screenshots, press Enter (dispatch `keydown`/`keyup` on `window`), and screenshot again. Expected: the play scene shows the red square and no hint. Close that tab.
9. Back in the editor, click **Reset to default**. Expected: the Box is gone, the Hint is back, and the status shows "Default (not edited)".
10. Set Sprite.frame of "Player" to 99. Expected: the viewport shows `Cannot draw this scene: Frame 99 is out of range…`, while the panels still work. Set it back to 0.

Then close the tab, stop the dev server (PowerShell `Get-CimInstance Win32_Process` filtered on `vite`), and confirm port 5173 is free.

- [ ] **Step 6: Commit**

```bash
git add src/editor
git commit -m "feat: editor entity list and inspector"
```
