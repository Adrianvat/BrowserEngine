import type { StoredSheet } from "../../engine";
import { FramesDocument, type Snapshot } from "../frames-document";
import { checkSize, type Rect } from "../pixels";
import { cleanClips, type Clips } from "../sheet";
import {
  hitShape,
  newShapeId,
  reserveShapeIds,
  shapeInRect,
  shapesBounds,
  simplifyPoints,
  snapShape,
  stretchShape,
  translateShape,
  type Geometry,
  type Point,
  type Shape,
  type ShapeStyle,
} from "./shapes";
import { parseSvg, serializeSvg, splitShapes, type VectorImage } from "./svg";

export type VectorTool = "select" | "rect" | "ellipse" | "line" | "polygon" | "pen";

export const VECTOR_TOOLS: readonly { tool: VectorTool; label: string; key: string }[] = [
  { tool: "select", label: "Select", key: "v" },
  { tool: "rect", label: "Rectangle", key: "r" },
  { tool: "ellipse", label: "Ellipse", key: "o" },
  { tool: "line", label: "Line", key: "l" },
  { tool: "polygon", label: "Polygon", key: "p" },
  { tool: "pen", label: "Pen", key: "n" },
];

/** A corner or side of the selection box that can be dragged to resize it. */
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** One frame: its size and its shapes, back to front. Never changed in place. */
export interface VectorFrame {
  readonly width: number;
  readonly height: number;
  readonly shapes: readonly Shape[];
}

export const DEFAULT_STYLE: ShapeStyle = { fill: "#000000", stroke: null, strokeWidth: 1 };

/** Shapes don't cost memory per pixel, so vector frames may be much bigger than pixel ones. */
export const VECTOR_MAX_SIZE = 4096;
/** Sheets of big vector frames still get long; this keeps them sane. */
const VECTOR_MAX_FRAMES = 256;

/** How far (in frame units) a press may land from a shape and still pick it up. */
export interface PressOptions {
  /** A selection handle under the pointer (the view knows where they are drawn). */
  handle?: Handle;
  /** Shift held: add to or take from the selection instead of replacing it. */
  shift?: boolean;
  /** Hit tolerance in frame units (a few screen pixels at the view's zoom). */
  tolerance?: number;
}

/** A press of a tool that is still held down. */
type Press =
  | { kind: "move"; origin: Point; originals: readonly Shape[]; snapshot: Snapshot<VectorFrame>; moved: boolean; toggle: Shape | null }
  | { kind: "resize"; handle: Handle; from: Rect; originals: readonly Shape[]; snapshot: Snapshot<VectorFrame>; changed: boolean }
  | { kind: "marquee"; anchor: Point; add: boolean; dragged: boolean }
  | { kind: "draw"; tool: "rect" | "ellipse" | "line"; anchor: Point }
  | { kind: "pen"; points: Point[] };

/** Where points within this distance of each other count as the same (a pen stroke's steps). */
const PEN_TOLERANCE = 0.75;

/**
 * A vector sprite: frames of shapes, the tool settings, and the selection. Shapes are
 * drawn by dragging (rectangle, ellipse, line, pen) or clicking points (polygon), then
 * selected, moved, resized by handles, restyled and reordered. Every edit is an undo step.
 */
export class VectorDocument extends FramesDocument<VectorFrame> {
  private currentTool: VectorTool = "select";
  private currentStyle: ShapeStyle = DEFAULT_STYLE;
  private snapping = true;
  private crisp = false;
  private selectedIds: number[] = [];
  private press: Press | null = null;
  /** The shape being dragged out, shown but not yet in the frame. */
  private draftShape: Shape | null = null;
  /** The polygon's points placed so far, and where the pointer is for the rubber band. */
  private polygonPoints: Point[] | null = null;
  private polygonCursor: Point | null = null;
  private marqueeRect: Rect | null = null;

  constructor(width = 16, height = 16) {
    checkSize(width, height, VECTOR_MAX_SIZE);
    super({ width, height, shapes: [] });
  }

  get width(): number {
    return this.current.width;
  }

  get height(): number {
    return this.current.height;
  }

  get tool(): VectorTool {
    return this.currentTool;
  }

  /** The style new shapes get; it follows the last selected shape. */
  get style(): ShapeStyle {
    return this.currentStyle;
  }

  /** True when points and sizes are rounded to whole pixels. */
  get snap(): boolean {
    return this.snapping;
  }

  /** True when the saved SVG asks for shapes without smoothing (pixel-art look). */
  get crispEdges(): boolean {
    return this.crisp;
  }

  /** The current frame's shapes, back to front. */
  get shapes(): readonly Shape[] {
    return this.current.shapes;
  }

  /** The selected shapes, back to front. */
  get selection(): Shape[] {
    return this.current.shapes.filter((shape) => this.selectedIds.includes(shape.id));
  }

  get selectionBounds(): Rect | null {
    return shapesBounds(this.selection);
  }

  get draft(): Shape | null {
    return this.draftShape;
  }

  /** The polygon in progress: its points, then the pointer (for the rubber band). */
  get polygon(): Point[] | null {
    if (!this.polygonPoints) return null;
    return this.polygonCursor ? [...this.polygonPoints, this.polygonCursor] : this.polygonPoints;
  }

  get marquee(): Rect | null {
    return this.marqueeRect;
  }

  get drawing(): boolean {
    return this.press !== null;
  }

  setTool(tool: VectorTool): void {
    this.cancelDraft();
    this.currentTool = tool;
    this.notify();
  }

  /** Changes the style for new shapes, and restyles the selected ones (an undo step). */
  setStyle(changes: Partial<ShapeStyle>): void {
    this.currentStyle = { ...this.currentStyle, ...changes };
    if (this.currentStyle.strokeWidth < 0 || !Number.isFinite(this.currentStyle.strokeWidth)) {
      this.currentStyle = { ...this.currentStyle, strokeWidth: 1 };
    }
    const selected = this.selection;
    if (selected.length === 0) {
      this.notify();
      return;
    }
    const snapshot = this.snapshot();
    this.replaceShapes(
      this.shapes.map((shape) =>
        this.selectedIds.includes(shape.id) ? { ...shape, style: { ...shape.style, ...changes } } : shape,
      ),
    );
    this.record(snapshot);
  }

  setSnap(snap: boolean): void {
    this.snapping = snap;
    this.notify();
  }

  setCrispEdges(crisp: boolean): void {
    this.crisp = crisp;
    this.touched();
  }

  /** Starts over with a blank, single-frame sprite of this size; the history is dropped. */
  reset(width: number, height: number, name = ""): void {
    checkSize(width, height, VECTOR_MAX_SIZE);
    this.crisp = false;
    this.load([{ width, height, shapes: [] }], {}, false, name, null);
  }

  /** Edits an existing vector image: split into frames by `sheet`, with its clips, or as one frame. */
  open(image: VectorImage, name: string, openedFrom: string | null, sheet: StoredSheet | null = null): void {
    checkSize(image.width, image.height, VECTOR_MAX_SIZE);
    reserveShapeIds(image.shapes);
    this.crisp = image.crispEdges;
    if (!sheet) {
      this.load([{ width: image.width, height: image.height, shapes: [...image.shapes] }], {}, false, name, openedFrom);
      return;
    }
    const { frameWidth, frameHeight } = sheet;
    const frames = splitShapes(image.shapes, image.width, image.height, frameWidth, frameHeight).map((shapes) => ({
      width: frameWidth,
      height: frameHeight,
      shapes,
    }));
    this.load(frames, cleanClips(sheet.animations, frames.length), true, name, openedFrom);
  }

  /** Takes over frames made elsewhere (e.g. traced from pixels), with their clips. */
  openFrames(
    frames: VectorFrame[],
    clips: Clips,
    asSheet: boolean,
    name: string,
    openedFrom: string | null,
    dirty: boolean,
    crispEdges = false,
  ): void {
    if (frames.length === 0) throw new Error("A sprite needs at least one frame");
    for (const frame of frames) reserveShapeIds(frame.shapes);
    this.crisp = crispEdges;
    this.load(frames, cleanClips(clips, frames.length), asSheet, name, openedFrom, dirty);
  }

  /** Opens SVG text; the notes say what in it couldn't be read. */
  openSvg(text: string, name: string, openedFrom: string | null, sheet: StoredSheet | null = null): string[] {
    const parsed = parseSvg(text);
    this.open(parsed, name, openedFrom, sheet);
    return parsed.notes;
  }

  /** The SVG file to store (a sheet of every frame when this is a sheet). */
  toSvg(): string {
    this.cancelDraft();
    const frames = this.isSheet ? this.frameList : [this.current];
    return serializeSvg(
      frames.map((frame) => frame.shapes),
      this.width,
      this.height,
      this.crisp,
    );
  }

  /** Changes the frame size; shapes keep their places (those outside are clipped when saved). An undo step. */
  resize(width: number, height: number): void {
    checkSize(width, height, VECTOR_MAX_SIZE);
    this.cancelDraft();
    if (width === this.width && height === this.height) return;
    const snapshot = this.snapshot();
    this.frameList = this.frameList.map((frame) => ({ ...frame, width, height }));
    this.record(snapshot);
  }

  /** Removes every shape of the current frame; an undo step. */
  clear(): void {
    this.cancelDraft();
    if (this.shapes.length === 0) return;
    const snapshot = this.snapshot();
    this.selectedIds = [];
    this.replaceShapes([]);
    this.record(snapshot);
  }

  /** The topmost shape at a point, if any. */
  hitTest(point: Point, tolerance: number): Shape | null {
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      if (hitShape(this.shapes[i], point, tolerance)) return this.shapes[i];
    }
    return null;
  }

  // Strokes

  /** Presses the tool at frame point (x, y). */
  beginStroke(x: number, y: number, options: PressOptions = {}): void {
    if (this.press) this.endStroke();
    const raw = { x, y };
    const point = this.point(raw);
    const tolerance = options.tolerance ?? 0.5;
    switch (this.currentTool) {
      case "select": {
        const box = this.selectionBounds;
        if (options.handle && box) {
          this.press = { kind: "resize", handle: options.handle, from: box, originals: this.selection, snapshot: this.snapshot(), changed: false };
          break;
        }
        const hit = this.hitTest(raw, tolerance);
        if (hit) {
          const selected = this.selectedIds.includes(hit.id);
          if (options.shift) {
            if (!selected) this.selectedIds = [...this.selectedIds, hit.id];
          } else if (!selected) {
            this.selectedIds = [hit.id];
          }
          this.followStyle();
          this.press = {
            kind: "move",
            origin: point,
            originals: this.selection,
            snapshot: this.snapshot(),
            moved: false,
            toggle: options.shift && selected ? hit : null,
          };
          break;
        }
        this.press = { kind: "marquee", anchor: raw, add: options.shift ?? false, dragged: false };
        break;
      }
      case "rect":
      case "ellipse":
      case "line":
        this.press = { kind: "draw", tool: this.currentTool, anchor: point };
        this.draftShape = this.shapeFrom(this.currentTool, point, point);
        break;
      case "pen":
        this.press = { kind: "pen", points: [raw] };
        this.draftShape = this.penShape([raw]);
        break;
      case "polygon": {
        const points = this.polygonPoints;
        if (points && points.length >= 3 && distance(point, points[0]) <= Math.max(tolerance, this.snapping ? 0.5 : 0)) {
          this.finishPolygon();
          return;
        }
        if (!points) this.polygonPoints = [point];
        else if (distance(point, points[points.length - 1]) > 0) this.polygonPoints = [...points, point];
        this.polygonCursor = point;
        break;
      }
    }
    this.notify();
  }

  /** Drags the pressed tool to (x, y); with the polygon tool, just moves the rubber band. */
  moveStroke(x: number, y: number): void {
    const raw = { x, y };
    const point = this.point(raw);
    if (this.polygonPoints && this.currentTool === "polygon") {
      this.polygonCursor = point;
      this.notify();
    }
    const press = this.press;
    if (!press) return;
    switch (press.kind) {
      case "move": {
        const dx = point.x - press.origin.x;
        const dy = point.y - press.origin.y;
        if (dx === 0 && dy === 0 && !press.moved) return;
        press.moved = true;
        const moved = new Map(press.originals.map((shape) => [shape.id, translateShape(shape, dx, dy)]));
        this.replaceShapes(this.shapes.map((shape) => moved.get(shape.id) ?? shape));
        this.notify();
        return;
      }
      case "resize": {
        const to = resizedBox(press.from, press.handle, point);
        const stretched = new Map(
          press.originals.map((shape) => {
            const next = stretchShape(shape, press.from, to);
            return [shape.id, this.snapping ? snapShape(next) : next];
          }),
        );
        press.changed = true;
        this.replaceShapes(this.shapes.map((shape) => stretched.get(shape.id) ?? shape));
        this.notify();
        return;
      }
      case "marquee":
        press.dragged = true;
        this.marqueeRect = rectBetweenPoints(press.anchor, raw);
        this.notify();
        return;
      case "draw":
        this.draftShape = this.shapeFrom(press.tool, press.anchor, point);
        this.notify();
        return;
      case "pen": {
        const last = press.points[press.points.length - 1];
        if (distance(raw, last) < 0.05) return;
        press.points.push(raw);
        this.draftShape = this.penShape(press.points);
        this.notify();
        return;
      }
    }
  }

  /** Releases the tool: adds the drawn shape, finishes the move or resize, or applies the marquee. */
  endStroke(): void {
    const press = this.press;
    if (!press) return;
    this.press = null;
    switch (press.kind) {
      case "move":
        if (press.moved) {
          this.pushHistory(press.snapshot);
          this.touched();
        } else if (press.toggle) {
          this.selectedIds = this.selectedIds.filter((id) => id !== press.toggle!.id);
          this.followStyle();
          this.notify();
        } else {
          this.notify();
        }
        return;
      case "resize":
        if (press.changed) {
          this.pushHistory(press.snapshot);
          this.touched();
        } else {
          this.notify();
        }
        return;
      case "marquee": {
        const rect = this.marqueeRect;
        this.marqueeRect = null;
        if (!press.dragged || !rect) {
          if (!press.add) this.selectedIds = [];
        } else {
          const hits = this.shapes.filter((shape) => shapeInRect(shape, rect)).map((shape) => shape.id);
          this.selectedIds = press.add ? [...new Set([...this.selectedIds, ...hits])] : hits;
        }
        this.followStyle();
        this.notify();
        return;
      }
      case "draw": {
        const draft = this.draftShape;
        this.draftShape = null;
        if (draft && isDrawable(draft)) this.addShape(draft);
        else this.notify();
        return;
      }
      case "pen": {
        this.draftShape = null;
        let points = simplifyPoints(press.points, PEN_TOLERANCE);
        if (this.snapping) points = dedupe(points.map((p) => this.point(p)));
        if (points.length >= 2) this.addShape(this.penShape(points));
        else this.notify();
        return;
      }
    }
  }

  /** Closes the polygon being placed (3 or more points; 2 make a line; fewer, nothing). */
  finishPolygon(): void {
    const points = this.polygonPoints;
    this.polygonPoints = null;
    this.polygonCursor = null;
    if (!points) return;
    if (points.length >= 3) {
      this.addShape({ id: newShapeId(), style: this.currentStyle, kind: "path", points, closed: true });
    } else if (points.length === 2) {
      this.addShape({ id: newShapeId(), style: this.lineStyle(), kind: "line", x1: points[0].x, y1: points[0].y, x2: points[1].x, y2: points[1].y });
    } else {
      this.notify();
    }
  }

  /** Drops a shape or polygon in progress. */
  cancelDraft(): void {
    if (this.press && this.press.kind !== "move" && this.press.kind !== "resize") this.press = null;
    else if (this.press) this.endStroke();
    this.draftShape = null;
    this.polygonPoints = null;
    this.polygonCursor = null;
    this.marqueeRect = null;
    this.notify();
  }

  // Selection

  selectAll(): void {
    this.cancelDraft();
    this.selectedIds = this.shapes.map((shape) => shape.id);
    this.followStyle();
    this.notify();
  }

  deselect(): void {
    this.cancelDraft();
    this.selectedIds = [];
    this.notify();
  }

  /** Selects these shapes (by id) and no others. */
  select(ids: readonly number[]): void {
    this.cancelDraft();
    const known = new Set(this.shapes.map((shape) => shape.id));
    this.selectedIds = ids.filter((id) => known.has(id));
    this.followStyle();
    this.notify();
  }

  /** Removes the selected shapes; an undo step. */
  deleteSelection(): void {
    if (this.selection.length === 0) return;
    const snapshot = this.snapshot();
    this.replaceShapes(this.shapes.filter((shape) => !this.selectedIds.includes(shape.id)));
    this.selectedIds = [];
    this.record(snapshot);
  }

  /** Adds copies of the selected shapes just above them, and selects the copies; an undo step. */
  duplicateSelection(): void {
    if (this.selection.length === 0) return;
    const snapshot = this.snapshot();
    const copies = new Map(this.selection.map((shape) => [shape.id, { ...translateShape(shape, 0, 0), id: newShapeId() }]));
    const shapes: Shape[] = [];
    for (const shape of this.shapes) {
      shapes.push(shape);
      const copy = copies.get(shape.id);
      if (copy) shapes.push(copy);
    }
    this.replaceShapes(shapes);
    this.selectedIds = [...copies.values()].map((shape) => shape.id);
    this.record(snapshot);
  }

  /** Slides the selected shapes; an undo step. */
  moveSelection(dx: number, dy: number): void {
    if (this.selection.length === 0 || (dx === 0 && dy === 0)) return;
    const snapshot = this.snapshot();
    this.replaceShapes(
      this.shapes.map((shape) => (this.selectedIds.includes(shape.id) ? translateShape(shape, dx, dy) : shape)),
    );
    this.record(snapshot);
  }

  /** Moves the selected shapes so their box sits in the middle of the frame. */
  centerSelection(): void {
    const box = this.selectionBounds;
    if (!box) return;
    let dx = (this.width - box.width) / 2 - box.x;
    let dy = (this.height - box.height) / 2 - box.y;
    if (this.snapping) {
      dx = Math.round(dx);
      dy = Math.round(dy);
    }
    this.moveSelection(dx, dy);
  }

  /** Moves the selected shapes one step toward the front (drawn later); an undo step. */
  bringForward(): void {
    this.reorder(1);
  }

  /** Moves the selected shapes one step toward the back (drawn earlier); an undo step. */
  sendBackward(): void {
    this.reorder(-1);
  }

  protected override dropSelection(): void {
    if (this.press) this.endStroke();
    this.draftShape = null;
    this.polygonPoints = null;
    this.polygonCursor = null;
    this.marqueeRect = null;
    this.selectedIds = [];
  }

  protected override frameLimit(): number {
    return VECTOR_MAX_FRAMES;
  }

  protected blankFrame(): VectorFrame {
    return { width: this.width, height: this.height, shapes: [] };
  }

  protected copyFrame(frame: VectorFrame): VectorFrame {
    return { ...frame, shapes: frame.shapes.map((shape) => ({ ...shape, id: newShapeId() })) };
  }

  private reorder(direction: 1 | -1): void {
    const shapes = [...this.shapes];
    const selected = (index: number) => this.selectedIds.includes(shapes[index].id);
    let changed = false;
    const snapshot = this.snapshot();
    if (direction === 1) {
      for (let i = shapes.length - 2; i >= 0; i--) {
        if (selected(i) && !selected(i + 1)) {
          [shapes[i], shapes[i + 1]] = [shapes[i + 1], shapes[i]];
          changed = true;
        }
      }
    } else {
      for (let i = 1; i < shapes.length; i++) {
        if (selected(i) && !selected(i - 1)) {
          [shapes[i], shapes[i - 1]] = [shapes[i - 1], shapes[i]];
          changed = true;
        }
      }
    }
    if (!changed) return;
    this.replaceShapes(shapes);
    this.record(snapshot);
  }

  private addShape(shape: Shape): void {
    const snapshot = this.snapshot();
    this.replaceShapes([...this.shapes, shape]);
    this.selectedIds = [shape.id];
    this.record(snapshot);
  }

  private replaceShapes(shapes: readonly Shape[]): void {
    this.setCurrent({ ...this.current, shapes });
  }

  /** The style panel follows the selection, so new shapes look like the last one picked. */
  private followStyle(): void {
    const selected = this.selection;
    if (selected.length > 0) this.currentStyle = selected[selected.length - 1].style;
  }

  private point(raw: Point): Point {
    return this.snapping ? { x: Math.round(raw.x), y: Math.round(raw.y) } : raw;
  }

  /** A pen stroke or line is drawn with the stroke color, or the fill color when there is no stroke. */
  private lineStyle(): ShapeStyle {
    const { fill, stroke, strokeWidth } = this.currentStyle;
    return { fill: null, stroke: stroke ?? fill ?? "#000000", strokeWidth: Math.max(strokeWidth, 1) };
  }

  private penShape(points: Point[]): Shape {
    return { id: newShapeId(), style: this.lineStyle(), kind: "path", points, closed: false };
  }

  private shapeFrom(tool: "rect" | "ellipse" | "line", a: Point, b: Point): Shape {
    const id = newShapeId();
    if (tool === "line") return { id, style: this.lineStyle(), kind: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    const box = rectBetweenPoints(a, b);
    const geometry: Geometry =
      tool === "rect"
        ? { kind: "rect", ...box }
        : { kind: "ellipse", cx: box.x + box.width / 2, cy: box.y + box.height / 2, rx: box.width / 2, ry: box.height / 2 };
    return { id, style: this.currentStyle, ...geometry };
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > 0);
}

function rectBetweenPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** A dragged-out shape with no size is a slip, not a shape. */
function isDrawable(shape: Shape): boolean {
  switch (shape.kind) {
    case "rect":
      return shape.width > 0 && shape.height > 0;
    case "ellipse":
      return shape.rx > 0 && shape.ry > 0;
    case "line":
      return shape.x1 !== shape.x2 || shape.y1 !== shape.y2;
    case "path":
      return shape.points.length >= 2;
  }
}

/** The selection box with the dragged handle's side(s) moved to the pointer, never thinner than 1. */
function resizedBox(from: Rect, handle: Handle, point: Point): Rect {
  let left = from.x;
  let top = from.y;
  let right = from.x + from.width;
  let bottom = from.y + from.height;
  if (handle.includes("w")) left = Math.min(point.x, right - 1);
  if (handle.includes("e")) right = Math.max(point.x, left + 1);
  if (handle.includes("n")) top = Math.min(point.y, bottom - 1);
  if (handle.includes("s")) bottom = Math.max(point.y, top + 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
