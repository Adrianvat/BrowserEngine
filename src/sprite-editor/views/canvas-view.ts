import type { SpriteDocument, Tool } from "../document";
import { rectContains } from "../pixels";
import { createZoomedCanvas, drawGrid, followDocument, type ZoomedCanvas } from "./zoomed-canvas";

export type CanvasView = ZoomedCanvas;

/**
 * The current frame, zoomed so every pixel is a square, over a checkerboard. Drawing with
 * the pointer runs the document's strokes; the wheel zooms. A brush outline follows the pointer.
 */
export function mountCanvasView(element: HTMLCanvasElement, doc: SpriteDocument, signal: AbortSignal): CanvasView {
  // The pixels at 1:1, drawn scaled onto the visible canvas.
  const backing = document.createElement("canvas");
  const backingCtx = backing.getContext("2d");
  if (!backingCtx) throw new Error("Canvas 2D is not available in this browser");
  // The previous frame at 1:1, for the onion skin.
  const onion = document.createElement("canvas");
  const onionCtx = onion.getContext("2d");
  if (!onionCtx) throw new Error("Canvas 2D is not available in this browser");

  let hover: { x: number; y: number } | null = null;

  /** Sprite pixel under the pointer (may be outside the sprite). */
  const toPixel = (event: PointerEvent) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: Math.floor(((event.clientX - bounds.left) / bounds.width) * doc.width),
      y: Math.floor(((event.clientY - bounds.top) / bounds.height) * doc.height),
    };
  };

  const paint = (ctx: CanvasRenderingContext2D, zoom: number, view: ZoomedCanvas) => {
    const { width, height, pixels } = doc;
    if (backing.width !== width || backing.height !== height) {
      backing.width = width;
      backing.height = height;
    }
    backingCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), width, height), 0, 0);
    const w = width * zoom;
    const h = height * zoom;
    ctx.imageSmoothingEnabled = false;
    const previous = view.onionSkin && doc.frame > 0 ? doc.frames[doc.frame - 1] : null;
    if (previous) {
      if (onion.width !== width || onion.height !== height) {
        onion.width = width;
        onion.height = height;
      }
      onionCtx.putImageData(new ImageData(new Uint8ClampedArray(previous.data), width, height), 0, 0);
      ctx.globalAlpha = 0.3;
      ctx.drawImage(onion, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(backing, 0, 0, w, h);
    if (view.grid) drawGrid(ctx, width, height, zoom);

    const selection = doc.selection;
    if (selection) {
      // Two dash patterns out of phase, so the outline shows on light and dark pixels alike.
      const x = selection.x * zoom + 0.5;
      const y = selection.y * zoom + 0.5;
      const sw = selection.width * zoom - 1;
      const sh = selection.height * zoom - 1;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "#000";
      ctx.strokeRect(x, y, sw, sh);
      ctx.lineDashOffset = 4;
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(x, y, sw, sh);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    if (hover && doc.tool !== "select") {
      const size = doc.tool === "fill" || doc.tool === "picker" ? 1 : doc.brushSize;
      const offset = Math.floor((size - 1) / 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.strokeRect((hover.x - offset) * zoom + 0.5, (hover.y - offset) * zoom + 0.5, size * zoom - 1, size * zoom - 1);
      ctx.strokeStyle = "#000";
      ctx.strokeRect((hover.x - offset) * zoom + 1.5, (hover.y - offset) * zoom + 1.5, size * zoom - 3, size * zoom - 3);
    }
  };

  const view = createZoomedCanvas(element, () => doc, paint, signal);

  /** A move cursor over the selection with the select tool; crosshairs elsewhere. */
  const updateCursor = () => {
    const selection = doc.selection;
    const overSelection =
      doc.tool === "select" && selection !== null && hover !== null && rectContains(selection, hover.x, hover.y);
    element.style.cursor = overSelection ? "move" : "crosshair";
  };

  element.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      const { x, y } = toPixel(event);
      let using: Tool | undefined;
      if (event.altKey) using = "picker";
      else if (event.button === 2) using = "eraser";
      doc.beginStroke(x, y, using);
      element.setPointerCapture(event.pointerId);
    },
    { signal },
  );
  element.addEventListener(
    "pointermove",
    (event) => {
      const point = toPixel(event);
      if (doc.drawing) doc.moveStroke(point.x, point.y);
      hover = point;
      updateCursor();
      view.redraw();
    },
    { signal },
  );
  element.addEventListener(
    "pointerleave",
    () => {
      hover = null;
      view.redraw();
    },
    { signal },
  );
  element.addEventListener("pointerup", () => doc.endStroke(), { signal });
  element.addEventListener("pointercancel", () => doc.endStroke(), { signal });
  element.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });

  followDocument(view, doc, updateCursor);
  return view;
}
