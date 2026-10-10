# Browser ECS Engine — Milestone 5: Scene Editor — Design

Date: 2026-10-10
Builds on: `docs/superpowers/specs/2026-10-10-ecs-engine-milestone-4-scenes-design.md`

## Goal

The engine is meant to run 100% in the browser, with an editor page and a game page. This milestone adds a basic editor. In it you can add, remove, edit and move the entities of the scenes the game declares. Scenes become data (their starting entities) plus code (their systems). The editor saves scene data in the browser's storage, and the game page plays it.

## Decisions

- The editor edits entities and their component values only. Game logic (systems) stays in TypeScript; editing logic in the browser is a later milestone.
- Edited scenes are saved in the browser's localStorage. The game page in the same browser loads them. There is no file export or import yet.
- Entities are moved by dragging them in the viewport, and by typing x/y in the inspector.
- The editor works on the scenes declared in code (`title`, `play`), picked from a dropdown. It cannot create new scenes.
- The UI is plain DOM + TypeScript. The viewport is drawn with the engine's own `World` and `render`. There are no runtime dependencies.

## Constraints

All earlier constraints still apply: TypeScript only (strict), no runtime dependencies, Canvas 2D, game code imports only from `src/engine/index.ts`. Editor code (`src/editor/`) also imports only from `src/engine/index.ts`, plus the game definition it edits.

## Success criteria

- `npm run dev`:
  - `/` plays the demo as before. The title and play scenes now load their entities from data.
  - `/editor.html` shows the editor.
- In the editor:
  - add an entity, rename it, give it a `Rect`, drag it, change its color;
  - remove an entity;
  - add and remove a component.
  
  Then **Play** opens the game, which shows the changes. **Reset to default** brings the original scene back.
- `npm test`, `npm run typecheck`, `npm run build` pass, and the build outputs both pages.

## Scene data

A scene's starting entities, as JSON:

```json
{
  "version": 1,
  "entities": [
    {
      "name": "Player",
      "components": {
        "Transform": { "x": 384, "y": 284 },
        "Sprite": { "image": "hero", "width": 32, "height": 32 },
        "Layer": { "value": 1 },
        "Animator": { "clip": "idle" },
        "Velocity": {},
        "Player": {}
      }
    }
  ]
}
```

```ts
interface EntityData {
  name: string;
  components: Record<string, Record<string, unknown>>; // registered name -> field values
}
interface SceneData {
  version: 1;
  entities: EntityData[];
}
```

- `name` becomes the entity's built-in `Name` component. `Name` is never listed under `components`.
- A field missing from the data keeps the component's constructor default.
- Only registered fields are saved. Runtime state (such as `Animator.time`) is not.
- Entities are spawned in array order, so later entities are drawn on top of earlier ones on the same layer.

## Registering components

```ts
type FieldKind =
  | "number"
  | "optionalNumber"        // may be empty (undefined): e.g. Sprite.width = natural size
  | "string"
  | "boolean"
  | "color"                 // a CSS color string
  | "image"                 // the name of a loaded image
  | { choice: readonly string[] };

interface ComponentDefinition {
  type: ComponentType;
  name: string;                            // the name used in scene data
  fields: Record<string, FieldKind>;
}

function component<T>(type: new () => T, name: string, fields: { [K in keyof T]?: FieldKind }): ComponentDefinition;

class ComponentRegistry {
  constructor(definitions: ComponentDefinition[]); // adds the built-in ones first
  get(name: string): ComponentDefinition | undefined;
  nameOf(type: ComponentType): string | undefined;
  all(): ComponentDefinition[];                     // built-ins first, then in the order given
}
```

- Registering a name twice throws `Component "<name>" is already registered`. This includes the name of a built-in.
- To build a component from data, the engine calls `new type()`, then assigns each field present in the data. So registered components need a constructor that works with no arguments.
- Built-in registrations:

| Name | Fields |
|---|---|
| `Transform` | `x`, `y`: number |
| `Rect` | `width`, `height`: number; `color`: color |
| `Sprite` | `image`: image; `frame`: number; `width`, `height`: optionalNumber; `flipX`, `flipY`: boolean |
| `Layer` | `value`: number |
| `Text` | `value`: string; `size`: number; `color`: color; `font`: string; `align`: choice left/center/right |
| `Animator` | `clip`: string |

- New no-argument defaults: `Rect(width = 32, height = 32, color = "white")`, `Sprite(image = "")`, `Text(value = "")`, `Animator(clip = "")`. Existing calls are unchanged.
- New built-in component `Name(value = "")`, with `findByName(world, name): Entity | undefined`. It returns the first entity, in spawn order, with that name.

## Loading and validating data

```ts
function parseSceneData(text: string, registry: ComponentRegistry): SceneData;      // from storage
function validateSceneData(value: unknown, registry: ComponentRegistry): SceneData; // from an imported JSON file
function spawnSceneData(world: World, data: SceneData, registry: ComponentRegistry): Entity[]; // in data order
```

Errors (`<i>` is the entity's index in the array):

- `Scene data is not valid JSON: <parser message>`
- `Scene data must be an object with "version" and "entities"`
- `Unsupported scene data version: <version>`
- `Entity <i> must have a "name" string and a "components" object`
- `Entity <i> ("<name>"): unknown component "<component>"`
- `Entity <i> ("<name>"): <Component> has no field "<field>"`
- `Entity <i> ("<name>"): <Component>.<field> must be <a number | a number or empty | a string | true or false | a color | an image name | one of left, center, right>`

Notes on the type checks:

- A color is any string; the browser decides whether it can draw it.
- An image name is any string; whether the image exists is checked when it is drawn, as today.
- An empty `optionalNumber` is stored by leaving the field out.

## Saved scenes

```ts
class SceneStore {
  constructor(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null);
  load(scene: string): string | null; // the saved JSON text, or null when none
  save(scene: string, data: SceneData): void;
  reset(scene: string): void;         // deletes the saved copy
}
```

- The key is `browser-engine:scene:<scene>`.
- If `storage` is `null` (unavailable), `load` returns `null`, and `save`/`reset` throw `Browser storage is not available`.
- An exception from the storage itself (for example quota exceeded) propagates from `save`/`reset`.
- The pages pass `localStorage`. If reading `localStorage` throws, they pass `null`.

## Game definition

Both pages import one plain object:

```ts
interface GameDefinition {
  width: number;
  height: number;
  pixelArt?: boolean;
  images: Record<string, ImageSource>;
  components: ComponentDefinition[];          // the game's own; built-ins are added automatically
  scenes: Record<string, { scene: Scene; data: unknown }>; // data: the default JSON, imported
  firstScene: string;
}
```

`src/game/definition.ts` holds the demo's definition. Scene default data lives in `src/game/scenes/title.json` and `play.json`, imported as JSON modules (`resolveJsonModule`).

## Game changes

- `GameOptions` gains:
  - `components?: ComponentDefinition[]` (Game builds a `ComponentRegistry` from them);
  - `sceneStore?: SceneStore` (when absent, only default data is used).
- `game.addScene(name, scene, data?: unknown)`: the scene's default data. Without data, the scene starts with no entities, as before.
- `game.registry`: the `ComponentRegistry`.
- `start(name)` first checks every added scene's data: the saved copy if there is one, otherwise the default. The first problem throws `Scene "<scene>": <message>`, before the loop starts, so the page can draw it.
- Entering a scene does the following:
  1. creates a fresh `World` with the global resources;
  2. spawns the scene's data (the saved copy if there is one, otherwise the default; read again each time the scene is entered);
  3. runs `setup`.

  If the data has become invalid since `start`, entering throws `Scene "<scene>": <message>`, like any other exception in the loop.

## Demo changes

- `src/game/definition.ts` declares:
  - the images, as today;
  - `Velocity` (`x`, `y`: number) and `Player` (no fields);
  - scenes `title` and `play`;
  - `firstScene: "title"`.
- `main.ts`:
  1. creates the `Game` from the definition, with `sceneStore` backed by `localStorage`;
  2. loads the images and adds the scenes;
  3. adds `Plays` as a global resource;
  4. calls `start`.

  Any startup error is drawn with `drawError`.
- `title.json`: entities "Background" (sprite, layer -1), "Prompt" (the "Press Enter to start" text) and "Plays label" (a text). `titleScene.setup` sets the "Plays label" text to `Games played: N` if that entity exists, then adds `startOnEnter`.
- `play.json`: entities "Background", "Player" (as in the example above, centered) and "Hint" (the "Esc: back to title" text, layer 2). `playScene.setup` increments `Plays.count`, spawns the 10 random bouncing rects, and adds the systems, as today.
- `index.html` keeps the game; `editor.html` is new. The Vite build gets both as inputs.

## Editor page

`editor.html` loads `src/editor/main.ts`. It builds the editor from the game definition, loads the definition's images, and shows:

- **Top bar:**
  - scene dropdown (the definition's scenes, in order);
  - **Play**: opens `/` in a new tab;
  - **Reset to default**: deletes the scene's saved copy and reloads its default;
  - status: `Saved`, `Default (not edited)` or `Not saved: <reason>`.
- **Entity list (left):**
  - every entity's name, in data order; click to select;
  - **+ Add entity**: appends "Entity N" (the smallest N not already used by an "Entity N" name) with a `Transform` at the center of the scene, and selects it;
  - **Remove**: removes the selected entity. The Delete key does the same, unless focus is in a text field.
- **Viewport (center):**
  - a canvas at the definition's width and height, drawn by the engine's `render` from a `World` built with `spawnSceneData`. It is rebuilt after every change, and no systems run.
  - The selected entity gets a 1px outline around its box, drawn after `render`.
  - An entity with a `Transform` but no `Rect`, `Sprite` or `Text` is drawn as a 9×9 cross marker centered on its Transform.
- **Inspector (right):** for the selected entity:
  - the name field;
  - one section per component, in data order, with an input per registered field:

    | Field kind | Input |
    |---|---|
    | number | number input |
    | optionalNumber | number input that may be empty |
    | string | text input |
    | boolean | checkbox |
    | color | text input plus a color picker (the picker sets a `#rrggbb` value) |
    | image | dropdown of image names |
    | choice | dropdown |

  - a **×** button per component to remove it;
  - **+ Add component**: a dropdown of registered components the entity doesn't have.

  Nothing is shown when no entity is selected.

### Selecting and dragging

- Each entity's box, at its Transform:
  - its `Rect` size; or
  - its `Sprite` drawn size (its width/height, else the frame's size); or
  - its `Text` box (width from the canvas's `measureText`, height = `size`; x adjusted for `align`); or
  - the 9×9 marker.
  
  When an entity has several, the union of its boxes is used. A flipped sprite keeps the same box.
- A pointer press in the viewport selects the top-most entity whose box contains the point, using the renderer's order: highest layer first, then the latest entity in data order. A press on empty space clears the selection.
- Dragging after the press moves the selected entity's `Transform` by the pointer's movement, in scene pixels, rounded to whole numbers. The inspector's x/y follow as you drag.
- Moves during a drag are not saved; the drag's end saves once.
- Pointer coordinates are converted from the canvas's on-screen size to scene pixels.

### Editor model

All changes go through one `EditorModel` (in `src/editor/model.ts`, tested in Node):

```ts
class EditorModel {
  constructor(definition: GameDefinition, store: SceneStore);
  readonly scene: string;              // current scene name
  readonly data: SceneData;            // current scene's data
  readonly selected: number | null;    // index into data.entities
  readonly status: "saved" | "default" | { error: string };
  readonly loadError: string | null;   // the saved copy couldn't be loaded
  openScene(name: string): void;       // clears the selection
  select(index: number | null): void;
  addEntity(): void;
  removeEntity(index: number): void;   // fixes up the selection
  rename(index: number, name: string): void;
  addComponent(index: number, component: string): void;  // its fields at their constructor defaults
  removeComponent(index: number, component: string): void;
  setField(index: number, component: string, field: string, value: unknown): void;
  move(index: number, x: number, y: number, save?: boolean): void; // save defaults to true
  resetScene(): void;
  onChange(listener: () => void): void;
}
```

- Every change except `select`, `openScene` and `move(..., false)` saves the scene. If saving throws, `status` becomes `{ error }` and the change is kept in memory.
- Adding a `Sprite` whose default image is `""` sets `image` to the definition's first image name.
- Adding a component the entity already has, or using an unknown index, component or field, throws. These are programmer errors; the UI never offers them.
- When the saved copy fails to load, `loadError` holds `Scene "<scene>": <message>`. The editor then shows that message and the Reset to default button instead of the panels. `data` is the default meanwhile, and nothing is saved until the reset.
- `move` on an entity without a `Transform` adds one.

The DOM views (`src/editor/views/...`) only render the model and forward input to it. Hit testing (`src/editor/hit-test.ts`) is a pure function taking the world, a point and a text-measuring function, and is tested in Node.

## Error handling

Programmer errors fail fast with descriptive messages: duplicate registration, unknown component or field in a model call. Bad data shows a message that names the scene and the problem. Storage failures are reported in the editor's status and never lose the in-memory edits.

## Testing

- **Registry:** built-ins present; duplicate names throw; `nameOf`.
- **Scene data:**
  - spawn every field kind;
  - missing fields keep defaults;
  - `Name` added;
  - entities returned in order;
  - every error message above;
  - `findByName`.
- **`SceneStore`:** with a fake storage, a `null` storage, and a storage whose `setItem` throws.
- **Game:**
  - data is spawned before `setup`;
  - the saved copy overrides the default;
  - bad saved data makes `start` throw with the scene name;
  - a scene without data starts empty.
- **Editor model:** every operation, its saving, status, selection fix-up, Sprite image default, load errors and reset.
- **Hit testing:** layer order, data order, rect, sprite (sized and natural), text with each align, the marker, unions, empty space.
- **Demo:** the JSON files validate against the demo registry; the title setup sets the "Plays label" text and works without it.
- **Manual browser check** of the success-criteria flow.

## Out of scope

Undo/redo, multi-select, copy/paste, zoom/pan, grid snapping, parent/child entities, creating scenes, editing images or animations, running the game inside the editor, exporting or importing files, editing systems in the browser, several games on one origin.
