import type { Rect } from "../../pixels";
import { createZoomedCanvas, drawGrid, followDocument, type ZoomedCanvas } from "../../views/zoomed-canvas";
import { drawShape, drawShapes, shapeBounds, type Point } from "../shapes";
import type { Handle, VectorDocument } from "../vector-document";

/** Handles are squares this many screen pixels across. */
const HANDLE_SIZE = 7;
/** How close (screen pixels) the pointer must be to pick a handle or a thin shape. */
const PICK_DISTANCE = 5;

const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const HANDLE_CURSORS: Record<Handle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

/** Where each handle sits on a box, in screen pixels. */
function handlePositions(box: Rect, zoom: number): Record<Handle, Point> {
  const left = box.x * zoom;
  const top = box.y * zoom;
  const right = (box.x + box.width) * zoom;
  const bottom = (box.y + box.height) * zoom;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  return {
    nw: { x: left, y: top },
    n: { x: midX, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: midY },
    se: { x: right, y: bottom },
    s: { x: midX, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: midY },
  };
}

/**
 * The current frame's shapes, zoomed, over a checkerboard, with the selection's box and
 * resize handles, the marquee, and shapes being drawn. Pointer presses go to the document.
 */
export function mountVectorCanvas(element: HTMLCanvasElement, doc: VectorDocument, signal: AbortSignal): ZoomedCanvas {
  let hover: Point | null = null;

  /** Frame coordinates under the pointer, fractional. */
  const toPoint = (event: PointerEvent | MouseEvent): Point => {
    const bounds = element.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * doc.width,
      y: ((event.clientY - bounds.top) / bounds.height) * doc.height,
    };
  };

  /** The handle under a frame point, if the select tool is active and there is a selection. */
  const handleAt = (point: Point, zoom: number): Handle | undefined => {
    const box = doc.selectionBounds;
    if (doc.tool !== "select" || !box) return undefined;
    const positions = handlePositions(box, zoom);
    const px = point.x * zoom;
    const py = point.y * zoom;
    return HANDLES.find((handle) => Math.abs(positions[handle].x - px) <= PICK_DISTANCE && Math.abs(positions[handle].y - py) <= PICK_DISTANCE);
  };

  const dashed = (ctx: CanvasRenderingContext2D, rect: Rect, zoom: number, color: string) => {
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#000";
    ctx.strokeRect(rect.x * zoom + 0.5, rect.y * zoom + 0.5, rect.width * zoom, rect.height * zoom);
    ctx.lineDashOffset = 4;
    ctx.strokeStyle = color;
    ctx.strokeRect(rect.x * zoom + 0.5, rect.y * zoom + 0.5, rect.width * zoom, rect.height * zoom);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  };

  const paint = (ctx: CanvasRenderingContext2D, zoom: number, view: ZoomedCanvas) => {
    ctx.save();
    ctx.scale(zoom, zoom);
    const previous = view.onionSkin && doc.frame > 0 ? doc.frames[doc.frame - 1] : null;
    if (previous) {
      ctx.globalAlpha = 0.3;
      drawShapes(ctx, previous.shapes);
      ctx.globalAlpha = 1;
    }
    drawShapes(ctx, doc.shapes);
    if (doc.draft) {
      ctx.globalAlpha = 0.8;
      drawShape(ctx, doc.draft);
      ctx.globalAlpha = 1;
    }
    const polygon = doc.polygon;
    if (polygon && polygon.length > 0) {
      ctx.beginPath();
      polygon.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.lineWidth = 1 / zoom;
      ctx.strokeStyle = "#38bdf8";
      ctx.stroke();
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.arc(polygon[0].x, polygon[0].y, 3 / zoom, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
    if (view.grid) drawGrid(ctx, doc.width, doc.height, zoom);

    const selected = doc.selection;
    if (selected.length > 0) {
      ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
      ctx.lineWidth = 1;
      for (const shape of selected) {
        const box = shapeBounds(shape);
        ctx.strokeRect(box.x * zoom + 0.5, box.y * zoom + 0.5, box.width * zoom, box.height * zoom);
      }
      const box = doc.selectionBounds;
      if (box && doc.tool === "select") {
        dashed(ctx, box, zoom, "#fff");
        const positions = handlePositions(box, zoom);
        for (const handle of HANDLES) {
          const { x, y } = positions[handle];
          ctx.fillStyle = "#fff";
          ctx.fillRect(x - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          ctx.strokeStyle = "#000";
          ctx.strokeRect(x - HANDLE_SIZE / 2 + 0.5, y - HANDLE_SIZE / 2 + 0.5, HANDLE_SIZE - 1, HANDLE_SIZE - 1);
        }
      }
    }
    if (doc.marquee) dashed(ctx, doc.marquee, zoom, "#38bdf8");
  };

  const view = createZoomedCanvas(element, () => doc, paint, signal);

  const updateCursor = () => {
    if (!hover) return;
    if (doc.tool !== "select") {
      element.style.cursor = "crosshair";
      return;
    }
    const handle = handleAt(hover, view.zoom);
    if (handle) element.style.cursor = HANDLE_CURSORS[handle];
    else if (doc.hitTest(hover, PICK_DISTANCE / view.zoom)) element.style.cursor = "move";
    else element.style.cursor = "default";
  };

  element.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const point = toPoint(event);
      doc.beginStroke(point.x, point.y, {
        handle: handleAt(point, view.zoom),
        shift: event.shiftKey,
        tolerance: PICK_DISTANCE / view.zoom,
      });
      element.setPointerCapture(event.pointerId);
    },
    { signal },
  );
  element.addEventListener(
    "pointermove",
    (event) => {
      hover = toPoint(event);
      doc.moveStroke(hover.x, hover.y);
      updateCursor();
    },
    { signal },
  );
  element.addEventListener("pointerup", () => doc.endStroke(), { signal });
  element.addEventListener("pointercancel", () => doc.endStroke(), { signal });
  element.addEventListener(
    "dblclick",
    (event) => {
      event.preventDefault();
      if (doc.tool === "polygon") doc.finishPolygon();
    },
    { signal },
  );
  element.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });

  followDocument(view, doc, updateCursor);
  return view;
}
