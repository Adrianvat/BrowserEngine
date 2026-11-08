# TODO

Ideas and features planned for later milestones.

## Physics

- **One-way platforms.** Colliders are solid from every side. Later: platforms that only stop a body coming from above.
- **Rotation.** Colliders are axis-aligned (boxes, and circles and capsules standing or lying); there is no angular velocity, so a box hit at a corner does not tip over. Rotated shapes would need an oriented overlap test and torque.
- **Fast, thin objects.** A box moving further than a wall's thickness in one step skips through it (bullets, very thin walls). Swept tests would catch that; for now keep walls thicker than speed / 60.

## Assets

- **Dynamic (background) asset loading — optional.** Today, images are loaded up front (`await game.assets.loadImages(...)`) before the game starts. Later, add an optional mode where images can be requested while the game is running and load in the background; sprites whose image isn't ready yet are skipped until it arrives. Up-front loading stays the default.

## Projects and the code editor

What there is today: a game is a **project**, a folder under `projects/` holding everything the editors write — `project.json` (name, size, pixel art, gravity, collision layers, the scene list and the start scene), `scripts/` (systems, components and scene setups as plain JavaScript modules loaded by the browser at runtime, with `order.json` for the systems' order), `scenes/*.json` (each scene's entities) and `images/` (with an optional `<name>.json` sheet layout next to an image). Nothing of a project is TypeScript, so one can be made, edited and deleted from the scene editor without a build; git carries them between machines. Every page takes `?project=<id>`; without it, a page opens the project last picked in the scene editor's dropdown (remembered in this browser, the one per-browser preference kept outside a file — see `src/project/page.ts`), or else the first project by id. The pages link to each other with the parameter, and the scene editor's dropdown updates what is remembered. The dev server serves the folders at `/api/projects` (`tools/game-files-plugin.ts`) and tells open pages when a file changes, whoever changed it; a production build bundles every project (`src/project/bundle.ts`), and the editors are then read-only. Beyond that one preference, nothing is kept in the browser's storage; what older versions left there is offered for import once.

The code editor (`/code-editor.html`) lists the project's scripts; a textarea edits them; every keystroke is checked by loading the scripts the way the game does; Save writes the file through the dev server, Vite reloads the game page with it and the scene editor picks up new components. Files changed with another editor show up too. Scripts can be added, removed and reordered.

- **Project settings in the editor.** The scene list and the start scene are edited in the scene editor's top bar; the name, size, pixel art, gravity and collision layers are still edited by hand in `project.json` (the editor re-reads it). A small settings panel would do; resizing means remounting the viewport.
- **Building one project.** `vite build` bundles every project, and the game page plays the first one unless the URL says otherwise. A build for release would take the project to ship (an environment variable, say) and leave the others and the editors out.
- **Renaming and copying projects.** A project can be made and deleted but not renamed (the id is the folder) or duplicated as a starting point. Both are a folder copy on the server side.
- **A real editor widget.** The editor is a textarea laid over a syntax-colored copy (`src/code-editor/highlight.ts`, a forgiving JavaScript tokenizer), with line numbers, the caret's line marked, Tab/Shift+Tab indenting and auto-indent on Enter. Bracket matching, search/replace, multiple cursors and folding would need much more; CodeMirror would bring them at the cost of the first runtime dependency. The overlay was checked with unit tests over a fake DOM, not by eye in every browser: Firefox's textarea metrics are the most likely to be a pixel off.
- **Smarter suggestions.** Completion (`src/code-editor/suggest.ts`) knows keywords, the `"engine"` exports and their classes' members (read from the prototypes), the names the scripts use, and script paths in imports, but has no type information: after a dot it guesses the class from the receiver's name (`world.` → World) and otherwise offers every known member. Real member completion would need a type checker (the TypeScript one, in the page) and declarations for the engine; cheaper wins: remembering `const keyboard = world.getResource(Keyboard)` within a script, and showing a one-line doc for engine members.
- **Color themes.** The colors are CSS variables (`--tok-*` in `code-editor.html`); a light theme or a theme picker would only need another set of values.
- **Error locations.** A script's syntax error is shown with the browser's message, but Chrome does not expose the line number on the error object (Firefox does); the console has it. A tiny tokenizer could at least point at unbalanced brackets, or the editor could mark the line from `error.stack` where available.
- **Scripts are JavaScript.** TypeScript would need a compiler in the page (the `typescript` package is large; `esbuild-wasm` or `sucrase` would do) and type information for the engine's API to be worth it. Related: completions for the `"engine"` exports.
- **Hot swap instead of reload.** The game page reloads when scripts are saved, losing the current scene. Re-importing only the changed systems and swapping them in the running scene is possible for systems (function identity does not matter) but not for components (entities hold instances of the old class).
- **Rename.** A script can only be added and removed; renaming a component would also have to rename it in every scene's saved data.
- **Concurrent edits.** The code editor writes a whole file; if the same file is being edited elsewhere at the same time, the last save wins (the other editor's change arrives here as a reload, which keeps unsaved drafts of other scripts but not of that one). The scene editor writes the open scene's file on every change, so two scene editors on the same scene overwrite each other's edits too, and two on the same project can overwrite each other's scene lists. Saving only when the file still has the content last read, and asking otherwise, would make this safe.
- **A broken scene file.** When a scene file can't be read (bad JSON, or a component whose script was removed), the scene editor shows the error and the file has to be fixed by hand (or restored from git); the old "Reset to default" went away with the saved copies. Offering to drop just the entities or components that don't fit would be friendlier.
- **Tests.** The models, the loader, the dev-server APIs and the demo project's scripts have unit tests; the views have smoke tests over a minimal fake DOM (`tests/helpers/fake-dom.ts`) and were not exercised in a real browser here. A browser test run would confirm the textarea behaviour (`execCommand` undo, gutter scroll sync) and the file-change reloads across tabs.

## Sprite editor

What the editor (`/sprite-editor.html`) does today: pixel-art and vector styles, frames and clips, a preview, selection/move, save to the game's image files. Found by reviewing the code and measuring in a headless browser; roughly in priority order within each group.

### Measured problems (do first)

- **Big pixel sprites redraw too slowly.** Painting on a 512×512 sprite runs at about 10 fps: the document update is cheap (~2.5 ms per pointer move) but every redraw copies and re-uploads the whole frame three times (canvas view, frame thumbnail, preview), 60–100 ms per frame. Fix: wrap `pixels.data` in `ImageData` without copying, `putImageData` only the dirty rectangle a stroke touched (the document knows it), and redraw the thumbnail and preview at most a few times a second while a stroke is in progress. 16×16 to 128×128 sprites are fine today.
- **Vector shapes are blurry on HiDPI screens.** The canvas backing store is sized in CSS pixels, so on a 2× display every edge is upscaled. Size the backing store by `devicePixelRatio` and scale the context (pixel art is unaffected: it is `image-rendering: pixelated`).
- **No zoom below 1:1 and no panning.** A 4096×4096 vector frame becomes a 4096×4096 canvas (64 MB) that is scrolled, and an 800×600 background doesn't fit on a small window. Allow fractional zoom-out, zoom around the pointer on wheel, and pan with space+drag / middle button; render only the visible part for large frames.
- **The frame strip rebuilds on every structural change.** Adding a frame re-creates and redraws every thumbnail (roughly 100 ms per added frame once there are 60). Insert/remove just the affected thumbnail instead.

### Drawing (pixel art)

- **Flip and rotate the selection** (horizontal flip is the most common sprite operation: a walk cycle facing the other way). Also rotate by 90° and flip the whole frame.
- **Copy and paste.** Nothing can be copied between frames or sprites; the selection can only be moved, centered or deleted. Add copy/cut/paste (within the page; the system clipboard as PNG where the browser allows it), and paste-as-new-frame.
- **Shape tools for pixel art:** line, rectangle and ellipse with pixel-perfect rasterization, and Shift to constrain the brush to straight lines.
- **Transparency.** The tools only make pixels fully opaque or fully transparent; the picker drops alpha. Opening a PNG keeps its partial alpha on untouched pixels, which is inconsistent. Either support alpha (color + opacity slider, eraser strength) or flatten on open and say so.
- **Scale the sprite.** "Size" crops or pads at the top-left. Add resize by scaling (nearest neighbour for pixel art) and an anchor choice (center, edges) for cropping.
- **Palette.** Fixed PICO-8 palette plus a color input. Add recent colors, a palette made from the image's colors, and editable palettes kept in browser storage.
- **Brush shapes and symmetry:** round brushes, a mirror-drawing mode (horizontal/vertical symmetry) for characters.

### Drawing (vector)

- **Curves.** Paths are straight segments; curves in opened SVGs are flattened into 8 segments each. Add a Bézier pen and node editing (move/add/delete points on a polygon or path).
- **Constraints and precision.** Shift for squares/circles/45° lines, Alt to draw from the center, numeric fields for the selection's position and size.
- **Rotate and transforms.** Shapes can't be rotated (opened SVG rotations are dropped with a note). Rotation handles, flip, and `transform` support in the SVG reader/writer.
- **More of SVG:** opacity, gradients (shown grey today), text, groups, dashed strokes. Keep the reader's "notes" so users always learn what was left out.
- **Eyedropper for vector** (pick a shape's style), and a fidelity preview: render the preview through the browser's SVG renderer (an `<img>` of the serialized file) so it shows exactly what the game draws, including `crispEdges`.
- **Vector → pixel conversion** rasterizes with anti-aliasing even when Crisp edges is on. Rasterize via the SVG renderer instead so the result matches the game.

### Animation

- **Split a plain image into frames from the editor.** A PNG sheet opened without a frame size is one big frame; the frame size can only be set in the scene editor. Add "split into W×H frames" (and "join frames into one image").
- **Build clips by clicking thumbnails** rather than typing "2, 3, 4"; show which frames a clip uses in the strip; a scrubber under the preview to step through a clip.
- **Per-frame timing.** `AnimationClip` has one fps for the whole clip, so a frame can't be held longer (an engine change: optional per-frame durations, or repeat a frame index as the workaround it is today).
- **Onion skin of the next frame too**, tinted differently from the previous one, with adjustable opacity.
- **Drag to reorder frames** in the strip, insert before, and copy a frame into another sprite.
- **Layers** (background / character / effects) in both styles, flattened on save. Also a per-sprite pivot point and per-frame hitboxes, which the engine would need to understand first (Sprite has no origin; colliders are per entity).

### Files and workflow

- **Import and export files.** No way to open a PNG/SVG from disk in the sprite editor (only the scene editor's "Add image" upload) or to download the drawn file (every image is a file under the project's `images/` now, so this matters less). Add Open file (and drag-and-drop onto the canvas) and Download.
- **Drafts.** Closing the tab warns about unsaved changes but nothing is kept. Autosave a draft (the one case where the browser's storage would earn its keep, since a draft is not a file yet) and offer to restore it.
- **Editing the same image in two tabs** silently lets the last save win, and the sprite editor doesn't notice when the scene editor changes the frame size of, or deletes, the image it has open (it only refreshes the Open list). Show "changed elsewhere; reload?" using the dev server's file-change events, which the page already listens to.
- **Sheet layout on save** is always rows wrapped at 512 px, so re-saving a 4×2 sheet turns it into 8×1. Frame indices are unchanged, so clips still work, but offer a column count for people who use the PNG elsewhere.
- **Save as.** Saving over an existing stored image asks, but there is no "save a copy" without retyping the name; Ctrl+D in pixel mode falls through to the browser's bookmark dialog.
- **Style conversion isn't undoable**: it replaces the document (the vector → pixel direction asks first). Keep the previous workspace for one step back.

### Plumbing and tests

- **The views have no automated tests.** The documents, sheet logic, SVG reader/writer and conversions are unit-tested (vitest, no DOM); the panels and pointer handling were only checked by hand in a headless browser. Add a browser test setup (vitest browser mode or Playwright) with a few end-to-end flows: draw–save–appears in scene editor, frames and clips, style switch.
- **Undo history** is capped at 50 steps regardless of size; at 512×512 that can be 50 MB. Cap by bytes, and share unchanged pixels (the copy-on-write frames already do this across frames, not within one).
- **Touch and small screens.** Pointer events work, but there is no pinch-zoom, no touch equivalent of right-click erase or Alt-pick, and the three-column layout has no narrow-window mode.
- **Accessibility.** Icon-only buttons (×, ◀, ▶) have titles but no `aria-label`; the canvas isn't keyboard-operable; the palette relies on color alone.

