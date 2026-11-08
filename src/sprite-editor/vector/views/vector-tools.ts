import { PALETTE, parseHex } from "../../color";
import { isTyping } from "../../views/tool-panel";
import type { ZoomedCanvas } from "../../views/zoomed-canvas";
import { VECTOR_TOOLS, type VectorDocument } from "../vector-document";

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

function checkbox(text: string, title: string, onChange: (checked: boolean) => void): [HTMLLabelElement, HTMLInputElement] {
  const label = document.createElement("label");
  label.title = title;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.addEventListener("change", () => onChange(input.checked));
  label.append(input, ` ${text}`);
  return [label, input];
}

/** Tools, fill and stroke, the palette, editing and ordering buttons, and the view options. */
export function mountVectorTools(root: HTMLElement, doc: VectorDocument, view: ZoomedCanvas): void {
  const tools = document.createElement("div");
  tools.className = "tool-list";
  const toolButtons = new Map<string, HTMLButtonElement>();
  for (const { tool, label, key } of VECTOR_TOOLS) {
    const element = button(label, `${label} (${key.toUpperCase()})`, () => doc.setTool(tool));
    const kbd = document.createElement("kbd");
    kbd.textContent = key.toUpperCase();
    element.append(kbd);
    toolButtons.set(tool, element);
    tools.append(element);
  }

  // Fill and stroke: a checkbox for none, a color, and the stroke's width.
  const paint = document.createElement("div");
  paint.className = "paint";
  let lastFill = doc.style.fill ?? "#000000";
  let lastStroke = doc.style.stroke ?? "#000000";
  const fillRow = document.createElement("div");
  fillRow.className = "paint-row";
  const [fillLabel, fillOn] = checkbox("Fill", "Whether shapes are filled", (on) => doc.setStyle({ fill: on ? lastFill : null }));
  const fillColor = document.createElement("input");
  fillColor.type = "color";
  fillColor.title = "Fill color";
  fillColor.addEventListener("input", () => {
    lastFill = fillColor.value;
    doc.setStyle({ fill: fillColor.value });
  });
  fillRow.append(fillLabel, fillColor);
  const strokeRow = document.createElement("div");
  strokeRow.className = "paint-row";
  const [strokeLabel, strokeOn] = checkbox("Stroke", "Whether shapes have an outline", (on) => doc.setStyle({ stroke: on ? lastStroke : null }));
  const strokeColor = document.createElement("input");
  strokeColor.type = "color";
  strokeColor.title = "Stroke color";
  strokeColor.addEventListener("input", () => {
    lastStroke = strokeColor.value;
    doc.setStyle({ stroke: strokeColor.value });
  });
  const strokeWidth = document.createElement("input");
  strokeWidth.type = "number";
  strokeWidth.min = "0.5";
  strokeWidth.step = "0.5";
  strokeWidth.title = "Stroke width in pixels";
  strokeWidth.addEventListener("change", () => {
    const width = strokeWidth.valueAsNumber;
    if (Number.isFinite(width) && width > 0) doc.setStyle({ strokeWidth: width });
  });
  strokeRow.append(strokeLabel, strokeColor, strokeWidth);
  paint.append(fillRow, strokeRow);

  // The palette sets the fill or the stroke.
  const target = document.createElement("div");
  target.className = "palette-target";
  const targetName = `palette-target-${Math.random().toString(36).slice(2)}`;
  const targets: HTMLInputElement[] = [];
  for (const [value, text] of [
    ["fill", "fill"],
    ["stroke", "stroke"],
  ]) {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = targetName;
    radio.value = value;
    radio.checked = value === "fill";
    targets.push(radio);
    label.append(radio, ` ${text}`);
    target.append(label);
  }
  const targetLabel = document.createElement("span");
  targetLabel.textContent = "Palette sets ";
  target.prepend(targetLabel);
  const palette = document.createElement("div");
  palette.className = "palette";
  for (const hex of PALETTE) {
    const swatch = button("", hex, () => {
      if (!parseHex(hex)) return;
      if (targets[0].checked) {
        lastFill = hex;
        doc.setStyle({ fill: hex });
      } else {
        lastStroke = hex;
        doc.setStyle({ stroke: hex });
      }
    });
    swatch.style.background = hex;
    palette.append(swatch);
  }

  const edits = document.createElement("div");
  edits.className = "edit-buttons";
  const undo = button("Undo", "Undo (Ctrl+Z)", () => doc.undo());
  const redo = button("Redo", "Redo (Ctrl+Shift+Z or Ctrl+Y)", () => doc.redo());
  const clear = button("Clear", "Remove every shape in this frame", () => doc.clear());
  edits.append(undo, redo, clear);

  const selection = document.createElement("div");
  selection.className = "edit-buttons";
  const selectAll = button("Select all", "Select every shape (Ctrl+A)", () => {
    doc.setTool("select");
    doc.selectAll();
  });
  const remove = button("Delete", "Remove the selected shapes (Delete)", () => doc.deleteSelection());
  const duplicate = button("Duplicate", "Copy the selected shapes (Ctrl+D)", () => doc.duplicateSelection());
  const forward = button("Forward", "Draw the selected shapes later, over others (Ctrl+])", () => doc.bringForward());
  const backward = button("Backward", "Draw the selected shapes earlier, under others (Ctrl+[)", () => doc.sendBackward());
  const center = button("Center", "Move the selected shapes to the middle of the frame", () => doc.centerSelection());
  const deselect = button("Deselect", "Select nothing (Esc)", () => doc.deselect());
  selection.append(selectAll, remove, duplicate, forward, backward, center, deselect);
  const selectionHint = document.createElement("p");
  selectionHint.className = "hint";
  selectionHint.textContent =
    "With the Select tool, click a shape or drag around shapes to select them (Shift adds). " +
    "Drag to move, drag the handles to resize. Arrow keys nudge (Shift: 8 px). " +
    "Polygon: click points, click the first point or press Enter to close. Double-click also closes.";

  const viewOptions = document.createElement("div");
  viewOptions.className = "edit-buttons";
  const zoomOut = button("−", "Zoom out (or scroll)", () => view.zoomOut());
  const zoomIn = button("+", "Zoom in (or scroll)", () => view.zoomIn());
  const fit = button("Fit", "Zoom to fit the window", () => view.fit());
  const [gridLabel, gridInput] = checkbox("Grid", "Show the pixel grid", (on) => {
    if (on !== view.grid) view.toggleGrid();
  });
  const [snapLabel, snapInput] = checkbox("Snap to pixels", "Round points and sizes to whole pixels", (on) => doc.setSnap(on));
  const [onionLabel, onionInput] = checkbox("Onion skin", "Show the previous frame faintly under this one", (on) => {
    if (on !== view.onionSkin) view.toggleOnionSkin();
  });
  const [crispLabel, crispInput] = checkbox(
    "Crisp edges",
    "Ask the game to draw the shapes without smoothing, like pixel art (saved in the file)",
    (on) => doc.setCrispEdges(on),
  );
  viewOptions.append(zoomOut, zoomIn, fit, gridLabel, snapLabel, onionLabel, crispLabel);

  root.replaceChildren(
    heading("Tools"),
    tools,
    heading("Paint"),
    paint,
    target,
    palette,
    heading("Edit"),
    edits,
    heading("Selection"),
    selection,
    selectionHint,
    heading("View"),
    viewOptions,
  );

  const update = () => {
    for (const [tool, element] of toolButtons) {
      element.setAttribute("aria-pressed", String(tool === doc.tool));
    }
    const { fill, stroke, strokeWidth: width } = doc.style;
    fillOn.checked = fill !== null;
    if (fill) {
      lastFill = fill;
      fillColor.value = fill;
    }
    fillColor.disabled = fill === null;
    strokeOn.checked = stroke !== null;
    if (stroke) {
      lastStroke = stroke;
      strokeColor.value = stroke;
    }
    strokeColor.disabled = stroke === null;
    if (strokeWidth !== document.activeElement) strokeWidth.value = String(width);
    strokeWidth.disabled = stroke === null;
    undo.disabled = !doc.canUndo;
    redo.disabled = !doc.canRedo;
    const none = doc.selection.length === 0;
    for (const element of [remove, duplicate, forward, backward, center, deselect]) element.disabled = none;
    gridInput.checked = view.grid;
    snapInput.checked = doc.snap;
    onionInput.checked = view.onionSkin;
    crispInput.checked = doc.crispEdges;
  };
  doc.onChange(update);
  update();
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Keyboard shortcuts for the vector tools, edits, selection and frames; ignored while typing in a field. */
export function installVectorShortcuts(doc: VectorDocument, signal: AbortSignal): void {
  document.addEventListener(
    "keydown",
    (event) => {
      if (isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === "z" && event.shiftKey) doc.redo();
        else if (key === "z") doc.undo();
        else if (key === "y") doc.redo();
        else if (key === "a") {
          doc.setTool("select");
          doc.selectAll();
        } else if (key === "d") doc.duplicateSelection();
        else if (key === "]") doc.bringForward();
        else if (key === "[") doc.sendBackward();
        else return;
        event.preventDefault();
        return;
      }
      if (event.altKey) return;
      const tool = VECTOR_TOOLS.find((entry) => entry.key === key);
      const nudge = ARROWS[event.key];
      if (tool) {
        doc.setTool(tool.tool);
      } else if (key === ",") {
        doc.setFrame(doc.frame - 1);
      } else if (key === ".") {
        doc.setFrame(doc.frame + 1);
      } else if (key === "enter") {
        doc.finishPolygon();
      } else if (key === "escape") {
        if (doc.polygon || doc.draft) doc.cancelDraft();
        else doc.deselect();
      } else if (nudge) {
        const step = event.shiftKey ? 8 : 1;
        doc.moveSelection(nudge[0] * step, nudge[1] * step);
      } else if (key === "delete" || key === "backspace") {
        doc.deleteSelection();
      } else {
        return;
      }
      event.preventDefault();
    },
    { signal },
  );
}
