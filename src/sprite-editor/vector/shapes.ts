import type { Rect } from "../pixels";

export interface Point {
  x: number;
  y: number;
}

/** How a shape is painted: a CSS color or null for none; the stroke width in pixels. */
export interface ShapeStyle {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}

export type ShapeKind = "rect" | "ellipse" | "line" | "path";

interface ShapeBase {
  /** Unique within the document, so a selection survives the shape being replaced by an edited copy. */
  id: number;
  style: ShapeStyle;
}

/** One vector shape. Shapes are never changed in place; edits make a new one with the same id. */
export type Shape = ShapeBase &
  (
    | { kind: "rect"; x: number; y: number; width: number; height: number }
    | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
    | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
    /** Straight segments through `points`: a polygon when closed, a polyline (pen stroke) when not. */
    | { kind: "path"; points: Point[]; closed: boolean }
  );

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A shape's geometry alone, before it gets an id and a style. */
export type Geometry = DistributiveOmit<Shape, "id" | "style">;

let lastId = 0;

/** An id no other shape has. */
export function newShapeId(): number {
  return ++lastId;
}

/** Makes sure ids handed out from now on don't clash with shapes loaded from a file. */
export function reserveShapeIds(shapes: Iterable<Shape>): void {
  for (const shape of shapes) lastId = Math.max(lastId, shape.id);
}

/** The shape's geometry box (the stroke may reach `strokeWidth / 2` beyond it). */
export function shapeBounds(shape: Shape): Rect {
  switch (shape.kind) {
    case "rect":
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    case "ellipse":
      return { x: shape.cx - shape.rx, y: shape.cy - shape.ry, width: 2 * shape.rx, height: 2 * shape.ry };
    case "line":
      return pointsBounds([
        { x: shape.x1, y: shape.y1 },
        { x: shape.x2, y: shape.y2 },
      ]);
    case "path":
      return pointsBounds(shape.points);
  }
}

function pointsBounds(points: readonly Point[]): Rect {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const { x, y } of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The box around every shape; null for none. */
export function shapesBounds(shapes: readonly Shape[]): Rect | null {
  if (shapes.length === 0) return null;
  const boxes = shapes.map(shapeBounds);
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  switch (shape.kind) {
    case "rect":
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    case "ellipse":
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
    case "line":
      return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy };
    case "path":
      return { ...shape, points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
}

/**
 * The shape as it would be if the box `from` were stretched to `to` (resizing a selection
 * by its handles). An axis `from` has no extent on is moved but not stretched.
 */
export function stretchShape(shape: Shape, from: Rect, to: Rect): Shape {
  const sx = from.width === 0 ? 1 : to.width / from.width;
  const sy = from.height === 0 ? 1 : to.height / from.height;
  const mapX = (x: number) => to.x + (x - from.x) * sx;
  const mapY = (y: number) => to.y + (y - from.y) * sy;
  switch (shape.kind) {
    case "rect":
      return { ...shape, x: mapX(shape.x), y: mapY(shape.y), width: shape.width * sx, height: shape.height * sy };
    case "ellipse":
      return { ...shape, cx: mapX(shape.cx), cy: mapY(shape.cy), rx: shape.rx * sx, ry: shape.ry * sy };
    case "line":
      return { ...shape, x1: mapX(shape.x1), y1: mapY(shape.y1), x2: mapX(shape.x2), y2: mapY(shape.y2) };
    case "path":
      return { ...shape, points: shape.points.map((p) => ({ x: mapX(p.x), y: mapY(p.y) })) };
  }
}

/** The shape with every coordinate rounded to whole pixels (sizes stay at least 1). */
export function snapShape(shape: Shape): Shape {
  const r = Math.round;
  switch (shape.kind) {
    case "rect":
      return { ...shape, x: r(shape.x), y: r(shape.y), width: Math.max(1, r(shape.width)), height: Math.max(1, r(shape.height)) };
    case "ellipse": {
      // Snap the box, not the center, so an ellipse can sit on whole pixels at any size.
      const x = r(shape.cx - shape.rx);
      const y = r(shape.cy - shape.ry);
      const width = Math.max(1, r(2 * shape.rx));
      const height = Math.max(1, r(2 * shape.ry));
      return { ...shape, cx: x + width / 2, cy: y + height / 2, rx: width / 2, ry: height / 2 };
    }
    case "line":
      return { ...shape, x1: r(shape.x1), y1: r(shape.y1), x2: r(shape.x2), y2: r(shape.y2) };
    case "path":
      return { ...shape, points: shape.points.map((p) => ({ x: r(p.x), y: r(p.y) })) };
  }
}

/** True when `point` is on the shape: inside its fill, or within `tolerance` of its stroke. */
export function hitShape(shape: Shape, point: Point, tolerance: number): boolean {
  const reach = Math.max(tolerance, shape.style.stroke ? shape.style.strokeWidth / 2 + tolerance / 2 : 0);
  const filled = shape.style.fill !== null;
  switch (shape.kind) {
    case "rect": {
      const inside =
        point.x >= shape.x - reach &&
        point.x <= shape.x + shape.width + reach &&
        point.y >= shape.y - reach &&
        point.y <= shape.y + shape.height + reach;
      if (!inside) return false;
      if (filled) return true;
      // Hollow: only near an edge.
      return (
        point.x <= shape.x + reach ||
        point.x >= shape.x + shape.width - reach ||
        point.y <= shape.y + reach ||
        point.y >= shape.y + shape.height - reach
      );
    }
    case "ellipse": {
      const outer = ellipseValue(point, shape.cx, shape.cy, shape.rx + reach, shape.ry + reach);
      if (outer > 1) return false;
      if (filled) return true;
      const innerRx = shape.rx - reach;
      const innerRy = shape.ry - reach;
      if (innerRx <= 0 || innerRy <= 0) return true;
      return ellipseValue(point, shape.cx, shape.cy, innerRx, innerRy) >= 1;
    }
    case "line":
      return segmentDistance(point, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }) <= reach;
    case "path": {
      const { points, closed } = shape;
      for (let i = 0; i + 1 < points.length; i++) {
        if (segmentDistance(point, points[i], points[i + 1]) <= reach) return true;
      }
      if (closed && points.length > 2) {
        if (segmentDistance(point, points[points.length - 1], points[0]) <= reach) return true;
        if (filled && insidePolygon(point, points)) return true;
      }
      return false;
    }
  }
}

function ellipseValue(p: Point, cx: number, cy: number, rx: number, ry: number): number {
  if (rx <= 0 || ry <= 0) return Infinity;
  const dx = (p.x - cx) / rx;
  const dy = (p.y - cy) / ry;
  return dx * dx + dy * dy;
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function insidePolygon(p: Point, points: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** True when the shape's box overlaps `rect` (marquee selection). */
export function shapeInRect(shape: Shape, rect: Rect): boolean {
  const box = shapeBounds(shape);
  return (
    box.x <= rect.x + rect.width &&
    box.x + box.width >= rect.x &&
    box.y <= rect.y + rect.height &&
    box.y + box.height >= rect.y
  );
}

/** Adds the shape's outline to the context's current path. */
export function traceShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  switch (shape.kind) {
    case "rect":
      ctx.rect(shape.x, shape.y, shape.width, shape.height);
      return;
    case "ellipse":
      ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, 2 * Math.PI);
      return;
    case "line":
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      return;
    case "path":
      shape.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      if (shape.closed) ctx.closePath();
      return;
  }
}

/** Paints the shape the way the browser paints it from the saved SVG (round joins and caps). */
export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.beginPath();
  traceShape(ctx, shape);
  const { fill, stroke, strokeWidth } = shape.style;
  if (fill && shape.kind !== "line") {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke && strokeWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
}

export function drawShapes(ctx: CanvasRenderingContext2D, shapes: readonly Shape[]): void {
  for (const shape of shapes) drawShape(ctx, shape);
}

/**
 * Fewer points that trace the same line within `tolerance` (Ramer–Douglas–Peucker),
 * so a pen stroke isn't hundreds of points.
 */
export function simplifyPoints(points: readonly Point[], tolerance: number): Point[] {
  if (points.length < 3) return [...points];
  const first = points[0];
  const last = points[points.length - 1];
  let farthest = 0;
  let farthestIndex = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const distance = segmentDistance(points[i], first, last);
    if (distance > farthest) {
      farthest = distance;
      farthestIndex = i;
    }
  }
  if (farthest <= tolerance) return [first, last];
  const head = simplifyPoints(points.slice(0, farthestIndex + 1), tolerance);
  const tail = simplifyPoints(points.slice(farthestIndex), tolerance);
  return [...head.slice(0, -1), ...tail];
}
