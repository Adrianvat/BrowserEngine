import { PALETTE, parseHex, toHex } from "../color";
import { MAX_BRUSH, MIN_BRUSH, TOOLS, type SpriteDocument } from "../document";
import type { CanvasView } from "./canvas-view";

function heading(text: string): HTMLHeadingElement {
  const h2 = document.createElement("h2");
  h2.textContent = text;
  return h2;
}

function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = text;
  element.title = title;
  element.addEventListener("click", onClick);
  return element;
}

/** Tools, brush size, the current color and palette, undo/redo/clear, and the view options. */
export function mountToolPanel(root: HTMLElement, doc: SpriteDocument, view: CanvasView): void {
  const tools = document.createElement("div");
  tools.className = "tool-list";
  const toolButtons = new Map<string, HTMLButtonElement>();
  for (const { tool, label, key } of TOOLS) {
    const element = button(label, `${label} (${key.toUpperCase()})`, () => doc.setTool(tool));
    const kbd = document.createElement("kbd");
    kbd.textContent = key.toUpperCase();
    element.append(kbd);
    toolButtons.set(tool, element);
    tools.append(element);
  }

  const size = document.createElement("div");
  size.className = "brush-size";
  const sizeInput = document.createElement("input");
  sizeInput.type = "range";
  sizeInput.min = String(MIN_BRUSH);
  sizeInput.max = String(MAX_BRUSH);
  sizeInput.title = "Brush size ([ and ] keys)";
  sizeInput.addEventListener("input", () => doc.setBrushSize(sizeInput.valueAsNumber));
  const sizeValue = document.createElement("span");
  size.append(sizeInput, sizeValue);

  const current = document.createElement("div");
  current.className = "current-color";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.title = "Pick any color";
  colorInput.addEventListener("input", () => {
    const color = parseHex(colorInput.value);
    if (color) doc.setColor(color);
  });
  const colorText = document.createElement("span");
  current.append(colorInput, colorText);

  const palette = document.createElement("div");
  palette.className = "palette";
  const swatches: HTMLButtonElement[] = [];
  for (const hex of PALETTE) {
    const swatch = button("", hex, () => {
      const color = parseHex(hex);
      if (color) doc.setColor(color);
    });
    swatch.style.background = hex;
    swatch.dataset.color = hex;
    swatches.push(swatch);
    palette.append(swatch);
  }

  const edits = document.createElement("div");
  edits.className = "edit-buttons";
  const undo = button("Undo", "Undo (Ctrl+Z)", () => doc.undo());
  const redo = button("Redo", "Redo (Ctrl+Shift+Z or Ctrl+Y)", () => doc.redo());
  const clear = button("Clear", "Make every pixel transparent", () => doc.clear());
  edits.append(undo, redo, clear);

  const selection = document.createElement("div");
  selection.className = "edit-buttons";
  const selectAll = button("Select all", "Select the whole sprite (Ctrl+A)", () => {
    doc.setTool("select");
    doc.selectAll();
  });
  const center = button("Center", "Move the selected pixels to the middle of the sprite", () =>
    doc.centerSelection(),
  );
  const deselect = button("Deselect", "Put the selection down (Enter or Esc)", () => doc.deselect());
  selection.append(selectAll, center, deselect);
  const selectionHint = document.createElement("p");
  selectionHint.className = "hint";
  selectionHint.textContent =
    "With the Select tool, drag to select; drag inside the selection to move it. " +
    "Arrow keys nudge it (Shift: 8 px), Delete clears it.";

  const viewOptions = document.createElement("div");
  viewOptions.className = "edit-buttons";
  const zoomOut = button("−", "Zoom out (or scroll)", () => view.zoomOut());
  const zoomIn = button("+", "Zoom in (or scroll)", () => view.zoomIn());
  const fit = button("Fit", "Zoom to fit the window", () => view.fit());
  const gridLabel = document.createElement("label");
  const gridInput = document.createElement("input");
  gridInput.type = "checkbox";
  gridInput.addEventListener("change", () => {
    if (gridInput.checked !== view.grid) view.toggleGrid();
  });
  gridLabel.append(gridInput, " Grid");
  const onionLabel = document.createElement("label");
  onionLabel.title = "Show the previous frame faintly under this one";
  const onionInput = document.createElement("input");
  onionInput.type = "checkbox";
  onionInput.addEventListener("change", () => {
    if (onionInput.checked !== view.onionSkin) view.toggleOnionSkin();
  });
  onionLabel.append(onionInput, " Onion skin");
  viewOptions.append(zoomOut, zoomIn, fit, gridLabel, onionLabel);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Right-click erases. Alt-click picks a color. Fast strokes are joined into lines. " +
    "Transparent pixels show as a checkerboard. , and . step through the frames.";

  root.replaceChildren(
    heading("Tools"),
    tools,
    heading("Brush size"),
    size,
    heading("Color"),
    current,
    palette,
    heading("Edit"),
    edits,
    heading("Selection"),
    selection,
    selectionHint,
    heading("View"),
    viewOptions,
    hint,
  );

  const update = () => {
    for (const [tool, element] of toolButtons) {
      element.setAttribute("aria-pressed", String(tool === doc.tool));
    }
    if (sizeInput !== document.activeElement) sizeInput.value = String(doc.brushSize);
    sizeValue.textContent = String(doc.brushSize);
    const hex = toHex(doc.color);
    colorInput.value = hex;
    colorText.textContent = hex;
    for (const swatch of swatches) {
      swatch.setAttribute("aria-pressed", String(swatch.dataset.color === hex));
    }
    undo.disabled = !doc.canUndo;
    redo.disabled = !doc.canRedo;
    center.disabled = doc.selection === null;
    deselect.disabled = doc.selection === null;
    gridInput.checked = view.grid;
    onionInput.checked = view.onionSkin;
  };
  doc.onChange(update);
  update();
}

/** True when keys go to a field the user is typing or stepping in (a checkbox isn't one). */
export function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(target.type);
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Keyboard shortcuts for the tools, edits, selection and frames; ignored while typing in a field. */
export function installShortcuts(doc: SpriteDocument, signal: AbortSignal): void {
  document.addEventListener("keydown", (event) => {
    if (isTyping(event.target)) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === "z" && event.shiftKey) doc.redo();
      else if (key === "z") doc.undo();
      else if (key === "y") doc.redo();
      else if (key === "a") {
        doc.setTool("select");
        doc.selectAll();
      } else return;
      event.preventDefault();
      return;
    }
    if (event.altKey) return;
    const tool = TOOLS.find((entry) => entry.key === key);
    const nudge = ARROWS[event.key];
    if (tool) {
      doc.setTool(tool.tool);
    } else if (key === "[") {
      doc.setBrushSize(doc.brushSize - 1);
    } else if (key === "]") {
      doc.setBrushSize(doc.brushSize + 1);
    } else if (key === ",") {
      doc.setFrame(doc.frame - 1);
    } else if (key === ".") {
      doc.setFrame(doc.frame + 1);
    } else if (doc.selection === null) {
      return;
    } else if (nudge) {
      const step = event.shiftKey ? 8 : 1;
      doc.moveSelection(nudge[0] * step, nudge[1] * step);
    } else if (key === "delete" || key === "backspace") {
      doc.deleteSelection();
    } else if (key === "enter" || key === "escape") {
      doc.deselect();
    } else {
      return;
    }
    event.preventDefault();
  }, { signal });
}
