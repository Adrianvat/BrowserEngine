import type { StoredSheet } from "../engine";
import { parseHex, TRANSPARENT, type Rgba } from "./color";
import { FramesDocument, type Snapshot } from "./frames-document";
import { clampRect, Pixels, rectBetween, rectContains, type Rect } from "./pixels";
import { assembleSheet, cleanClips, splitSheet, type Clips } from "./sheet";

export type Tool = "brush" | "eraser" | "fill" | "picker" | "select";

export const TOOLS: readonly { tool: Tool; label: string; key: string }[] = [
  { tool: "brush", label: "Brush", key: "b" },
  { tool: "eraser", label: "Eraser", key: "e" },
  { tool: "fill", label: "Fill", key: "g" },
  { tool: "picker", label: "Pick color", key: "i" },
  { tool: "select", label: "Select", key: "m" },
];

export const MIN_BRUSH = 1;
export const MAX_BRUSH = 16;

/** What a new sprite looks like when nothing else was asked for. */
export const DEFAULT_WIDTH = 16;
export const DEFAULT_HEIGHT = 16;
export const DEFAULT_COLOR = "#000000";

/** A press of a tool that is still held down. */
type Stroke =
  /** Painting; `snapshot` is the state before it, for undo. */
  | { kind: "paint"; tool: "brush" | "eraser" | "fill"; x: number; y: number; snapshot: Snapshot<Pixels> }
  /** Dragging out a selection rectangle from the pressed pixel; a plain click selects nothing. */
  | { kind: "marquee"; anchorX: number; anchorY: number; dragged: boolean }
  /** Dragging the selected pixels; (x, y) is where the pointer was last. */
  | { kind: "move"; x: number; y: number };

/**
 * A pixel-art sprite: frames of pixels, the tool settings, and the selection. Strokes
 * run from beginStroke through moveStroke to endStroke; each paint stroke is one undo
 * step. Moving a selection lifts its pixels out of the frame until they are committed
 * (by deselecting, or by any other edit); the lift through the commit is one undo step.
 */
export class SpriteDocument extends FramesDocument<Pixels> {
  private stroke: Stroke | null = null;
  private selected: Rect | null = null;
  /** The selected pixels while they are being moved; `selected` says where they are now. */
  private lifted: Pixels | null = null;
  /** The current frame with `lifted` drawn on it, made when asked for. */
  private composite: Pixels | null = null;
  private currentTool: Tool = "brush";
  private currentColor: Rgba = parseHex(DEFAULT_COLOR) ?? TRANSPARENT;
  private size = 1;

  constructor(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
    super(new Pixels(width, height));
  }

  /** The current frame as it looks, lifted selection included. Don't change it: use the tools. */
  get pixels(): Pixels {
    if (!this.lifted || !this.selected) return this.current;
    if (!this.composite) {
      this.composite = this.current.clone();
      this.composite.draw(this.lifted, this.selected.x, this.selected.y);
    }
    return this.composite;
  }

  get width(): number {
    return this.current.width;
  }

  get height(): number {
    return this.current.height;
  }

  get tool(): Tool {
    return this.currentTool;
  }

  get color(): Rgba {
    return this.currentColor;
  }

  get brushSize(): number {
    return this.size;
  }

  get drawing(): boolean {
    return this.stroke !== null;
  }

  /** The selected rectangle; it may reach outside the frame while its pixels are being moved. */
  get selection(): Rect | null {
    return this.selected;
  }

  /** True while the selected pixels are lifted out of the frame, mid-move. */
  get floating(): boolean {
    return this.lifted !== null;
  }

  setTool(tool: Tool): void {
    this.currentTool = tool;
    this.notify();
  }

  /** Only opaque colors are painted; transparency comes from the eraser. */
  setColor(color: Rgba): void {
    this.currentColor = [color[0], color[1], color[2], 255];
    this.notify();
  }

  setBrushSize(size: number): void {
    this.size = Math.min(MAX_BRUSH, Math.max(MIN_BRUSH, Math.round(size)));
    this.notify();
  }

  /** Starts over with a blank, single-frame sprite of this size; the history is dropped. */
  reset(width: number, height: number, name = ""): void {
    this.forgetEdits();
    this.load([new Pixels(width, height)], {}, false, name, null);
  }

  /**
   * Edits an existing image: split into frames by `sheet`, with its clips, or as one
   * frame. Saving replaces the image file `openedFrom`, if given.
   */
  open(pixels: Pixels, name: string, openedFrom: string | null, sheet: StoredSheet | null = null): void {
    this.forgetEdits();
    if (!sheet) {
      this.load([pixels.clone()], {}, false, name, openedFrom);
      return;
    }
    const frames = splitSheet(pixels, sheet.frameWidth, sheet.frameHeight);
    this.load(frames, cleanClips(sheet.animations, frames.length), true, name, openedFrom);
  }

  /** Takes over frames made elsewhere (e.g. converted from vector shapes), with their clips. */
  openFrames(frames: Pixels[], clips: Clips, asSheet: boolean, name: string, openedFrom: string | null, dirty: boolean): void {
    if (frames.length === 0) throw new Error("A sprite needs at least one frame");
    this.forgetEdits();
    this.load(frames, cleanClips(clips, frames.length), asSheet, name, openedFrom, dirty);
  }

  /**
   * What to store: every frame in one image, plus the frame size and clips when this
   * is a sheet. A lifted selection is included where it is now.
   */
  toSheet(): { pixels: Pixels; sheet: StoredSheet | null } {
    const frames = this.frameList.map((frame, index) => (index === this.index ? this.pixels : frame));
    if (!this.isSheet) return { pixels: frames[0], sheet: null };
    return { pixels: assembleSheet(frames), sheet: this.sheet };
  }

  /** Crops or pads every frame (anchored at the top-left); an undo step. */
  resize(width: number, height: number): void {
    const next = this.pixels.resized(width, height);
    this.deselect();
    if (width === this.width && height === this.height) return;
    const snapshot = this.snapshot();
    this.frameList = this.frameList.map((frame, index) => (index === this.index ? next : frame.resized(width, height)));
    this.record(snapshot);
  }

  /** Makes every pixel of the current frame transparent; an undo step. */
  clear(): void {
    this.deselect();
    if (this.current.isBlank()) return;
    const snapshot = this.snapshot();
    this.setCurrent(new Pixels(this.width, this.height));
    this.record(snapshot);
  }

  // Strokes

  /**
   * Presses a tool at frame pixel (x, y): the selected one, or `using` (Alt-click picks
   * a color, the right button erases). Positions outside the frame are fine: nothing
   * is painted there, but a brush dragged back in continues the line.
   */
  beginStroke(x: number, y: number, using: Tool = this.currentTool): void {
    if (this.stroke) this.endStroke();
    const tool = using;
    if (tool === "picker") {
      const color = this.pixels.get(x, y);
      if (color[3] !== 0) this.setColor(color);
      return;
    }
    if (tool === "select") {
      if (this.selected && rectContains(this.selected, x, y)) {
        this.stroke = { kind: "move", x, y };
      } else {
        this.deselect();
        const anchorX = Math.min(this.width - 1, Math.max(0, x));
        const anchorY = Math.min(this.height - 1, Math.max(0, y));
        this.stroke = { kind: "marquee", anchorX, anchorY, dragged: false };
        this.selected = rectBetween(anchorX, anchorY, anchorX, anchorY);
      }
      this.notify();
      return;
    }
    // Painting works on the frame itself, so a moved selection is committed first.
    this.deselect();
    const snapshot = this.snapshot();
    const working = this.working();
    this.stroke = { kind: "paint", tool, x, y, snapshot };
    const changed =
      tool === "fill"
        ? working.fill(x, y, this.currentColor)
        : working.stamp(x, y, this.size, this.paint(tool));
    if (changed) this.touched();
  }

  /** Drags the pressed tool to (x, y). The fill and picker tools act only on the press. */
  moveStroke(x: number, y: number): void {
    const stroke = this.stroke;
    if (!stroke) return;
    if (stroke.kind === "marquee") {
      const cornerX = Math.min(this.width - 1, Math.max(0, x));
      const cornerY = Math.min(this.height - 1, Math.max(0, y));
      if (cornerX !== stroke.anchorX || cornerY !== stroke.anchorY) stroke.dragged = true;
      this.selected = rectBetween(stroke.anchorX, stroke.anchorY, cornerX, cornerY);
      this.notify();
      return;
    }
    if (stroke.kind === "move") {
      const dx = x - stroke.x;
      const dy = y - stroke.y;
      stroke.x = x;
      stroke.y = y;
      if (dx !== 0 || dy !== 0) this.moveSelection(dx, dy);
      return;
    }
    const { tool, x: fromX, y: fromY } = stroke;
    stroke.x = x;
    stroke.y = y;
    if (tool === "fill") return;
    if (fromX === x && fromY === y) return;
    if (this.current.line(fromX, fromY, x, y, this.size, this.paint(tool))) this.touched();
  }

  /** Releases the tool; a paint stroke becomes one undo step if it changed anything. */
  endStroke(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stroke = null;
    if (stroke.kind === "paint" && !stroke.snapshot.frames[stroke.snapshot.index].equals(this.current)) {
      this.pushHistory(stroke.snapshot);
    }
    if (stroke.kind === "marquee" && !stroke.dragged) this.selected = null;
    this.notify();
  }

  // Selection

  /** Selects the whole frame (committing any moved pixels first). */
  selectAll(): void {
    this.select({ x: 0, y: 0, width: this.width, height: this.height });
  }

  /** Selects the part of `rect` inside the frame; nothing, if none of it is. */
  select(rect: Rect): void {
    this.commitSelection();
    this.selected = clampRect(rect, this.width, this.height);
    this.notify();
  }

  /** Puts any moved pixels down and drops the selection. */
  deselect(): void {
    this.commitSelection();
    this.selected = null;
    this.notify();
  }

  /**
   * Slides the selected pixels by (dx, dy). The first move lifts them out of the frame;
   * they can be moved again, and are put down by commitSelection. Whatever ends up
   * outside the frame is lost when they are put down.
   */
  moveSelection(dx: number, dy: number): void {
    if (!this.selected || (dx === 0 && dy === 0)) return;
    this.lift();
    this.selected = { ...this.selected, x: this.selected.x + dx, y: this.selected.y + dy };
    this.touched();
  }

  /** Moves the selection so that its opaque pixels sit in the middle of the frame. */
  centerSelection(): void {
    if (!this.selected) return;
    const content = (this.lifted ?? this.current.region(this.selected)).bounds();
    if (!content) return;
    const x = Math.floor((this.width - content.width) / 2) - (this.selected.x + content.x);
    const y = Math.floor((this.height - content.height) / 2) - (this.selected.y + content.y);
    this.moveSelection(x, y);
  }

  /** Makes the selected pixels transparent; the selection stays. An undo step. */
  deleteSelection(): void {
    if (!this.selected) return;
    if (this.lifted) {
      // The lift already recorded the undo step; the pixels just don't come back down.
      this.lifted = null;
      this.selected = clampRect(this.selected, this.width, this.height);
      this.touched();
      return;
    }
    const snapshot = this.snapshot();
    if (!this.working().clearRegion(this.selected)) return;
    this.record(snapshot);
  }

  /** Puts moved pixels down where they are now; the selection stays (trimmed to the frame). */
  commitSelection(): void {
    if (!this.lifted || !this.selected) return;
    this.current.draw(this.lifted, this.selected.x, this.selected.y);
    this.lifted = null;
    this.selected = clampRect(this.selected, this.width, this.height);
    this.touched();
  }

  protected override settle(): void {
    this.commitSelection();
  }

  protected override dropSelection(): void {
    if (this.stroke) this.endStroke();
    this.deselect();
  }

  protected blankFrame(): Pixels {
    return new Pixels(this.width, this.height);
  }

  protected copyFrame(frame: Pixels): Pixels {
    return frame.clone();
  }

  protected override notify(): void {
    this.composite = null;
    super.notify();
  }

  private paint(tool: "brush" | "eraser"): Rgba {
    return tool === "eraser" ? TRANSPARENT : this.currentColor;
  }

  /** Takes the selected pixels out of the frame, recording the undo step for the move. */
  private lift(): void {
    if (this.lifted || !this.selected) return;
    this.pushHistory(this.snapshot());
    const working = this.working();
    this.lifted = working.region(this.selected);
    working.clearRegion(this.selected);
  }

  /** The current frame as a fresh copy that is safe to change in place (snapshots keep the old one). */
  private working(): Pixels {
    const copy = this.current.clone();
    this.setCurrent(copy);
    return copy;
  }

  /** Drops a stroke and selection in progress without committing them (the frames are being replaced). */
  private forgetEdits(): void {
    this.stroke = null;
    this.selected = null;
    this.lifted = null;
  }
}

export type { ClipChanges, Clips } from "./sheet";
