import type { StoredSheet } from "../engine";
import { History } from "./history";
import {
  clipsAfterInsertingFrame,
  clipsAfterRemovingFrame,
  clipsAfterSwappingFrames,
  maxFrames,
  withClipChanges,
  withNewClip,
  withoutClip,
  type ClipChanges,
  type Clips,
} from "./sheet";

/** What undo restores: the frames, which one was being edited, and the clips. */
export interface Snapshot<F> {
  frames: readonly F[];
  index: number;
  clips: Clips;
}

/**
 * A sprite made of frames of some kind (pixels, or vector shapes), the clips that
 * animate them, and undo history. Edits happen on the current frame. Subclasses add
 * the drawing tools; they must never change a frame in place once a snapshot may hold
 * it, but put a changed copy in its place, so snapshots can share frames.
 * Listeners hear about every change, so views can redraw.
 */
export abstract class FramesDocument<F> {
  protected frameList: F[];
  protected index = 0;
  protected clipList: Clips = {};
  /** True once the sprite is a sheet (opened as one, or given frames or clips), so it saves as one. */
  protected asSheet = false;
  private history = new History<Snapshot<F>>();
  private spriteName = "";
  private opened: string | null = null;
  private unsaved = false;
  private readonly listeners: (() => void)[] = [];

  constructor(first: F) {
    this.frameList = [first];
  }

  /** The size of each frame. */
  abstract get width(): number;
  abstract get height(): number;

  /** Changes the frame size (anchored at the top-left) for every frame; an undo step. */
  abstract resize(width: number, height: number): void;

  /** A new, empty frame of the current size. */
  protected abstract blankFrame(): F;

  /** An independent copy of a frame, for duplicating it. */
  protected abstract copyFrame(frame: F): F;

  /** How many frames of the current size a sprite may have. */
  protected frameLimit(): number {
    return maxFrames(this.width, this.height);
  }

  /** Finishes an edit in progress (e.g. puts a moved selection down) so the frames are settled. */
  protected settle(): void {}

  /** Settles and drops any selection, before the current frame changes or the frames are replaced. */
  protected dropSelection(): void {
    this.settle();
  }

  /** Every frame, the current one as it is mid-edit. */
  get frames(): readonly F[] {
    return this.frameList;
  }

  /** The frame being edited, numbered from 0. */
  get frame(): number {
    return this.index;
  }

  get frameCount(): number {
    return this.frameList.length;
  }

  get clips(): Clips {
    return this.clipList;
  }

  /** True when saving makes a sprite sheet (frame size and clips) rather than a plain image. */
  get isSheet(): boolean {
    return this.asSheet || this.frameList.length > 1 || Object.keys(this.clipList).length > 0;
  }

  /** The frame size and clips to store with a sheet; null for a plain image. */
  get sheet(): StoredSheet | null {
    if (!this.isSheet) return null;
    return { frameWidth: this.width, frameHeight: this.height, animations: { ...this.clipList } };
  }

  get name(): string {
    return this.spriteName;
  }

  /** The image file this was opened from, which saving replaces; null for a new sprite. */
  get openedFrom(): string | null {
    return this.opened;
  }

  /** True when anything changed since the sprite was made, opened or saved. */
  get dirty(): boolean {
    return this.unsaved;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  setName(name: string): void {
    this.spriteName = name;
    this.notify();
  }

  /** Call after a save so the sprite counts as clean and as the image file `name`. */
  saved(name: string): void {
    this.spriteName = name;
    this.opened = name;
    this.unsaved = false;
    this.notify();
  }

  // Frames

  /** Switches to frame `index` (putting any moved selection down first). */
  setFrame(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.frameList.length) return;
    this.dropSelection();
    this.index = index;
    this.notify();
  }

  /** Inserts a blank frame after the current one and switches to it; an undo step. */
  addFrame(): void {
    this.insertFrame(this.blankFrame());
  }

  /** Inserts a copy of the current frame after it and switches to the copy; an undo step. */
  duplicateFrame(): void {
    this.dropSelection();
    this.insertFrame(this.copyFrame(this.current));
  }

  /** Removes the current frame; refused for the last frame, or a clip's only frame. An undo step. */
  removeFrame(): void {
    if (this.frameList.length === 1) throw new Error("A sprite needs at least one frame");
    const clips = clipsAfterRemovingFrame(this.clipList, this.index);
    this.dropSelection();
    const snapshot = this.snapshot();
    this.frameList = this.frameList.filter((_, index) => index !== this.index);
    this.index = Math.min(this.index, this.frameList.length - 1);
    this.clipList = clips;
    this.record(snapshot);
  }

  /** Swaps the current frame with the one `delta` places along (-1 or 1) and follows it; clips follow too. */
  moveFrame(delta: number): void {
    const to = this.index + delta;
    if (!Number.isInteger(to) || to < 0 || to >= this.frameList.length || to === this.index) return;
    this.dropSelection();
    const snapshot = this.snapshot();
    const frames = [...this.frameList];
    [frames[this.index], frames[to]] = [frames[to], frames[this.index]];
    this.frameList = frames;
    this.clipList = clipsAfterSwappingFrames(this.clipList, this.index, to);
    this.index = to;
    this.record(snapshot);
  }

  // Clips

  /** Adds a clip playing the current frame, named "clip" (or "clip-2"…); an undo step. Returns the name. */
  addClip(): string {
    this.settle();
    const snapshot = this.snapshot();
    const { clips, name } = withNewClip(this.clipList, this.index);
    this.clipList = clips;
    this.asSheet = true;
    this.record(snapshot);
    return name;
  }

  /** Changes or renames a clip; throws (changing nothing) when the result couldn't play. An undo step. */
  updateClip(name: string, changes: ClipChanges): void {
    const clips = withClipChanges(this.clipList, name, changes, this.frameList.length);
    this.settle();
    const snapshot = this.snapshot();
    this.clipList = clips;
    this.record(snapshot);
  }

  removeClip(name: string): void {
    const clips = withoutClip(this.clipList, name);
    this.settle();
    const snapshot = this.snapshot();
    this.clipList = clips;
    this.record(snapshot);
  }

  // History

  undo(): void {
    this.dropSelection();
    const current = this.snapshot();
    const previous = this.history.undo(current);
    if (!previous) return;
    // Redo should show the frame the change is on, as undo does, not wherever the user was.
    current.index = previous.index;
    this.restore(previous);
  }

  redo(): void {
    this.dropSelection();
    const next = this.history.redo(this.snapshot());
    if (next) this.restore(next);
  }

  protected get current(): F {
    return this.frameList[this.index];
  }

  /** Puts `frame` in the current frame's place. */
  protected setCurrent(frame: F): void {
    this.frameList[this.index] = frame;
  }

  protected insertFrame(frame: F): void {
    const limit = this.frameLimit();
    if (this.frameList.length >= limit) {
      throw new Error(`A sprite with ${this.width}x${this.height} frames can have at most ${limit} frames`);
    }
    this.dropSelection();
    const snapshot = this.snapshot();
    const at = this.index + 1;
    this.frameList = [...this.frameList.slice(0, at), frame, ...this.frameList.slice(at)];
    this.clipList = clipsAfterInsertingFrame(this.clipList, at);
    this.index = at;
    this.asSheet = true;
    this.record(snapshot);
  }

  protected snapshot(): Snapshot<F> {
    return { frames: [...this.frameList], index: this.index, clips: this.clipList };
  }

  /** Makes the change just made one undo step. */
  protected record(snapshot: Snapshot<F>): void {
    this.history.push(snapshot);
    this.touched();
  }

  /** Records an undo step for a change that is about to be made over several notifications. */
  protected pushHistory(snapshot: Snapshot<F>): void {
    this.history.push(snapshot);
  }

  private restore(snapshot: Snapshot<F>): void {
    this.frameList = [...snapshot.frames];
    this.index = snapshot.index;
    this.clipList = snapshot.clips;
    this.touched();
  }

  /** Starts over with these frames and clips; the history is dropped. */
  protected load(frames: F[], clips: Clips, asSheet: boolean, name: string, openedFrom: string | null, dirty = false): void {
    this.dropSelection();
    this.history.clear();
    this.frameList = frames;
    this.index = 0;
    this.clipList = clips;
    this.asSheet = asSheet;
    this.spriteName = name;
    this.opened = openedFrom;
    this.unsaved = dirty;
    this.notify();
  }

  protected touched(): void {
    this.unsaved = true;
    this.notify();
  }

  protected notify(): void {
    for (const listener of this.listeners) listener();
  }
}
