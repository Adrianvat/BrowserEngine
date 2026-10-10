# Browser ECS Engine — Milestone 6: Images in the Editor — Design

Date: 2026-10-11
Builds on: `docs/superpowers/specs/2026-10-10-ecs-engine-milestone-5-editor-design.md`

## Goal

Entities can already have a `Sprite` that picks an image by name. Those images are declared in code (`definition.images`). This milestone lets you add images in the editor, so the engine stays usable 100% in the browser:

- you upload an image file from your computer;
- you turn it into a sprite sheet (frame size) and give it animation clips;
- the image appears in the Sprite image dropdowns and plays in the game.

## Decisions

- Images are added by uploading a file. The editor has an **Images** panel with an **Add image** button.
- For an uploaded image, the editor edits:
  - the frame size, which makes it a sprite sheet;
  - its animation clips: name, frames list (`2, 3, 4, 5`), fps and loop.
  So `Animator` works with uploaded sheets.
- Images declared in code (built-ins: `background`, `hero`) stay read-only in the editor. They are listed, tagged `code`, and can be used by sprites, but they cannot be changed or deleted there. An upload can never take a built-in name.
- Uploaded images are stored in **IndexedDB**. Each record holds the file as a Blob, the frame size and the clips. The editor and game pages share an origin, so the game reads the same database.
- Images cannot be renamed, and their file cannot be replaced. To change either, delete the image and upload it again.

## Constraints

All earlier constraints still apply: TypeScript only (strict), no runtime dependencies, Canvas 2D, game and editor code import only from `src/engine/index.ts` (plus the game definition). Tests run in Vitest under Node, with no DOM and no IndexedDB. Browser-only pieces are injected so the logic can be tested.

## Success criteria

- `npm run dev`. In `/editor.html`:
  1. Click **Add image** and pick a PNG sprite sheet. It appears in the Images list under a name derived from its file name.
  2. Set its frame width and height. A numbered frame grid appears over the preview.
  3. Add a clip with frames `0, 1, 2, 3`, fps 8 and loop on.
  4. Give an entity a `Sprite` using that image and an `Animator` using that clip.
  5. Press **Play**. In `/`, the entity animates with the uploaded sheet.
- Reloading either page keeps the image, its frame size and its clips.
- Deleting an image used by a Sprite first asks for confirmation, listing the entities and scenes that use it.
- Invalid sheet edits are rejected with a message and never stored.
- `npm test`, `npm run typecheck` and `npm run build` pass.

## Architecture

### Stored image

```ts
interface StoredImage {
  name: string;
  file: Blob; // the uploaded file, unchanged
  sheet?: {
    // absent = a single image (one frame)
    frameWidth: number;
    frameHeight: number;
    animations: Record<string, AnimationClip>; // the engine's existing type
  };
}
```

### `ImageStore` (`src/engine/data/image-store.ts`)

`ImageStore` wraps the store of uploaded images behind a small async interface: `list(): Promise<StoredImage[]>`, `save(image): Promise<void>` (overwrites by name) and `remove(name): Promise<void>`.

- It is built on an `ImageStorage` interface with the same three operations.
- `browserImageStore(): Promise<ImageStore>` opens and returns an `ImageStore` backed by IndexedDB: database `browser-engine`, object store `images`, keyed by `name`.
- If IndexedDB is unavailable or fails to open, `browserImageStore()` resolves to an **unavailable** store instead of rejecting:
  - `list()` resolves to `[]`;
  - `save` and `remove` reject with `Images can't be saved in this browser`;
  - `ImageStore.available` is `false`.
- Tests use an in-memory `ImageStorage` (`tests/helpers/memory-image-storage.ts`).

### `toImageSources` (`src/engine/data/image-store.ts`)

`toImageSources(stored, builtIns, createUrl)` is a pure function that returns `Record<string, ImageSource>` for `Assets.loadImages`:

- It starts with the built-ins.
- A single image becomes `createUrl(file)`.
- A sheet becomes a `SheetSource` with `url: createUrl(file)` plus its frame size and clips.
- A stored image whose name matches a built-in is skipped, with a `console.warn`: the built-in wins.

`createUrl` is `URL.createObjectURL` in the browser and a fake in tests. The default loader (`loadBrowserImage`) already accepts `blob:` URLs: `fetch` works on them and the Blob's type is the image type.

### `checkSheet` (extracted from `Assets`)

The validation `Assets` does for a sheet becomes an exported pure function: `checkSheet(name, width, height, sheet) → { columns, count, animations }`, where `width` and `height` are the image's size in pixels. It covers:

- positive-integer frame size;
- an image smaller than one frame;
- per clip: no frames, invalid fps, frame out of range.

`Assets` calls it, and its error messages stay exactly the same. The existing `Assets` tests must pass unchanged.

The editor adds checks of its own on top:

- frame width and height must be both empty or both filled;
- clip names must be non-empty and unique.

### Image names (`src/editor/image-names.ts`)

`imageNameFromFile(fileName, taken)`:

1. Drop the extension, lowercase, and turn runs of characters other than `a-z0-9` into `-`; trim `-` from both ends. `Slime Sheet.png` becomes `slime-sheet`.
2. Fall back to `image` if nothing is left.
3. Add `-2`, `-3`… until the name is not in `taken`. `taken` holds built-in and uploaded names.

### `ImageLibrary` (`src/editor/image-library.ts`)

`ImageLibrary` owns the editor's image state. Its dependencies are injected:

- `builtIns: Record<string, ImageSource>`;
- `store: ImageStore`;
- `assets: Assets` (the editor's instance);
- `decode: (file: Blob) => Promise<{ width: number; height: number }>`;
- `createUrl: (file: Blob) => string`.

`ImageLibrary.load()` lists the store and loads every image into `assets`. A stored image that fails to load is kept in the list with its error message. It does not stop the editor from opening. The failure is recorded on that image, and the editor shows it.

Reads:

- `names`: built-ins first, in definition order, then uploaded images, sorted;
- `isBuiltIn(name)`;
- `image(name)`: the stored record or the built-in source, plus its size, frame count and load error;
- `available`: the store's flag.

Writes are async; each one validates, saves, then reloads that image into `assets`:

- `add(file, fileName)`: decodes the file to check it is an image, names it, and stores it as a single image;
- `setFrameSize(name, width, height)`: both `null` makes it a single image again;
- `addClip(name)`: adds `clip`, `clip-2`…, with frames `[0]`, fps 8 and loop on;
- `updateClip(name, clipName, changes)`: `changes` can include a new clip name, frames, fps and loop;
- `removeClip(name, clipName)`;
- `remove(name)`.

Validation and write rules:

- An invalid write rejects with a message and changes nothing.
- A write on a built-in rejects.
- If the store rejects a save, the in-memory state is left as it was before the write, and the error is reported.
- After every successful change, `onChange` listeners run.

`usages(name, scenes)` returns `{ entity, scene }[]` for every Sprite whose `image` is `name`. `scenes` is each scene's current data: the saved copy if one exists, otherwise the default.

### `EditorModel`

`EditorModel.imageNames` comes from the library's `names`, not from `definition.images`. The model takes a function or getter for this, so its tests can pass a plain list. When the library changes, the inspector's dropdowns refresh.

### Views

`editor.html`:

- The left column widens to about 260px.
- It splits into **Entities** (`#entities`) and **Images** (`#images`).

`views/image-list.ts`:

- Lists image names. Built-ins are tagged `code`, and an image that failed to load gets an error marker.
- Clicking a name selects it; clicking it again deselects it. Image selection is separate from entity selection.
- Has an **Add image** button that opens a hidden `<input type="file" accept="image/*">`. The button is disabled with a note when the store is unavailable.
- Shows panel-level messages, such as "Couldn't read <file> as an image" or "Couldn't save image: <reason>".

`views/image-details.ts` shows the selected image under the list:

- A preview canvas, scaled to fit the panel width. When it is a sheet, a grid overlay numbers each frame.
- Frame width and height number inputs. Both empty means a single image.
- A clips table with one row per clip: name, frames text (`2, 3, 4, 5`), fps, loop checkbox and ✕. Below it, an **Add clip** button.
- **Delete image**. If `usages` finds any, it first shows an inline confirmation, "Used by Hero (play), Logo (title). Delete anyway?", with **Delete** and **Cancel**.
- For a built-in: the same preview, grid and clips, read-only, with "Defined in code".

Editing in the details view:

- An input change calls the matching library write.
- On rejection, the input gets a red outline and the message appears next to it. The stored value is unchanged, and the input keeps the user's text so they can fix it.
- Frames text is parsed as integers separated by commas and/or spaces. Text that doesn't parse is rejected with `Frames must be numbers like 2, 3, 4`.
- Following the milestone 5 pattern, a refresh skips the focused input.

### Editor `main.ts`

1. Build the `ImageLibrary`, using `browserImageStore()`, the editor `Assets`, a browser `decode` built on `createImageBitmap`, and `URL.createObjectURL`.
2. Await `library.load()`.
3. Mount the views.

If a built-in fails to load, the page still shows the "Failed to load images" message as today.

### Game `main.ts`

1. Await `(await browserImageStore()).list()`.
2. Call `game.assets.loadImages(toImageSources(stored, definition.images, URL.createObjectURL))`.
3. Start.

Any failure goes to the existing error screen, which names the image.

## Errors

| Situation | Behavior |
|---|---|
| File that doesn't decode as an image | Not stored. The panel shows `Couldn't read <file> as an image`. |
| IndexedDB unavailable | Built-ins work. **Add image** is disabled, with `Images can't be saved in this browser`. The game loads only built-ins. |
| Save fails (quota, etc.) | The change is not applied. The panel shows `Couldn't save image: <reason>`. |
| Invalid sheet or clip edit | Field-level message. Not stored. |
| Stored image fails to load in the editor | Listed with an error marker and its message. The rest of the editor works. |
| Stored image fails to load in the game | The existing error screen, naming the image. |
| Sprite uses a deleted image | Same as today for an unknown image name. |

## Testing

Unit tests run in Vitest under Node:

- **`tests/engine/image-store.test.ts`**:
  - `ImageStore` over in-memory storage: save then list, overwrite by name, remove;
  - the unavailable store: empty list, rejected writes, `available` false;
  - `toImageSources`: a single image, a sheet, the built-in winning a clash, URLs from `createUrl`.
- **`tests/engine/assets.test.ts`**:
  - unchanged existing cases;
  - new direct `checkSheet` cases: frame size, smaller than one frame, clip errors, the returned count and columns.
- **`tests/editor/image-names.test.ts`**:
  - `Slime Sheet.png` → `slime-sheet`;
  - `-2`/`-3` suffixes;
  - built-in names avoided;
  - `!!!.png` → `image`.
- **`tests/editor/image-library.test.ts`**, with a fake decoder, fake `createUrl`, `Assets` with a fake loader, and in-memory store:
  - load, including an image that fails to load;
  - add;
  - set and clear the frame size, then check that the store and `assets.frameCount` reflect it;
  - add, update and remove a clip, then check that `assets.getAnimation` reflects it;
  - each kind of invalid edit is rejected and the store is unchanged;
  - built-in writes are rejected;
  - a failed save leaves the state unchanged;
  - `usages` across scenes;
  - remove;
  - `onChange`.
- **`tests/editor/model.test.ts`**: `imageNames` includes uploaded names.

The DOM views are verified manually in Chrome, following the success criteria. The file is uploaded with the browser extension's file-upload tool, or with a `DataTransfer` on the file input.

## Out of scope

- renaming images, or replacing an image's file;
- editing built-in images;
- drag-and-drop upload;
- clip playback preview in the panel;
- export or import of images and scenes.
