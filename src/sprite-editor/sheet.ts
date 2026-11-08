import type { AnimationClip } from "../engine";
import { uniqueName } from "../editor/image-names";
import { MAX_SIZE, Pixels } from "./pixels";

/** The named clips of a sprite; never changed in place, always replaced. */
export type Clips = Readonly<Record<string, AnimationClip>>;

/** The parts of a clip to change; a new `name` renames it in place. */
export interface ClipChanges {
  name?: string;
  frames?: number[];
  fps?: number;
  loop?: boolean;
}

export const DEFAULT_FPS = 8;

/** How many frames of this size fit in one row of a sheet the editor can make. */
export function sheetColumns(frameWidth: number, count: number): number {
  return Math.max(1, Math.min(count, Math.floor(MAX_SIZE / frameWidth)));
}

/** How many frames of this size a sheet can hold. */
export function maxFrames(frameWidth: number, frameHeight: number): number {
  return Math.floor(MAX_SIZE / frameWidth) * Math.floor(MAX_SIZE / frameHeight);
}

/** The frames of a sheet, left to right then top to bottom; leftover pixels at the edges are dropped. */
export function splitSheet(sheet: Pixels, frameWidth: number, frameHeight: number): Pixels[] {
  const columns = Math.floor(sheet.width / frameWidth);
  const rows = Math.floor(sheet.height / frameHeight);
  if (columns === 0 || rows === 0) {
    throw new Error(
      `The image (${sheet.width}x${sheet.height}) is smaller than one ${frameWidth}x${frameHeight} frame`,
    );
  }
  const frames: Pixels[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      frames.push(
        sheet.region({ x: column * frameWidth, y: row * frameHeight, width: frameWidth, height: frameHeight }),
      );
    }
  }
  return frames;
}

/** One image holding every frame, in rows of sheetColumns, in the order the engine numbers them. */
export function assembleSheet(frames: readonly Pixels[]): Pixels {
  if (frames.length === 0) throw new Error("A sheet needs at least one frame");
  const { width, height } = frames[0];
  const columns = sheetColumns(width, frames.length);
  const rows = Math.ceil(frames.length / columns);
  const sheet = new Pixels(columns * width, rows * height);
  frames.forEach((frame, index) => {
    if (frame.width !== width || frame.height !== height) {
      throw new Error("Every frame of a sheet must be the same size");
    }
    sheet.draw(frame, (index % columns) * width, Math.floor(index / columns) * height);
  });
  return sheet;
}

/** Throws, with a message for the user, unless the clip can play over `frameCount` frames. */
export function checkClip(name: string, clip: AnimationClip, frameCount: number): void {
  if (clip.frames.length === 0) throw new Error(`Clip "${name}" needs at least one frame`);
  for (const frame of clip.frames) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) {
      throw new Error(
        `Clip "${name}": frame ${frame} doesn't exist (frames are numbered 0 to ${frameCount - 1})`,
      );
    }
  }
  if (!(Number.isFinite(clip.fps) && clip.fps > 0)) {
    throw new Error(`Clip "${name}" needs a speed above 0 frames per second`);
  }
}

/** Clips that still play as before once stored frames are dropped or reordered; invalid references are removed. */
export function cleanClips(clips: Clips, frameCount: number): Clips {
  const cleaned: Record<string, AnimationClip> = {};
  for (const [name, clip] of Object.entries(clips)) {
    const frames = clip.frames.filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < frameCount);
    if (frames.length === 0 || !(Number.isFinite(clip.fps) && clip.fps > 0)) continue;
    cleaned[name] = { frames, fps: clip.fps, loop: clip.loop ?? true };
  }
  return cleaned;
}

/** The clips with a new, blank one named "clip" (or "clip-2"…) playing `frame`. */
export function withNewClip(clips: Clips, frame: number): { clips: Clips; name: string } {
  const name = uniqueName("clip", Object.keys(clips));
  return { clips: { ...clips, [name]: { frames: [frame], fps: DEFAULT_FPS, loop: true } }, name };
}

/** The clips with `name` changed (or renamed, keeping its place); throws when the result is invalid. */
export function withClipChanges(clips: Clips, name: string, changes: ClipChanges, frameCount: number): Clips {
  const current = clips[name];
  if (!current) throw new Error(`Clip "${name}" not found`);
  const newName = changes.name ?? name;
  if (newName === "") throw new Error("Clip name can't be empty");
  if (newName !== name && Object.hasOwn(clips, newName)) throw new Error(`Clip "${newName}" already exists`);
  const updated: AnimationClip = {
    frames: [...(changes.frames ?? current.frames)],
    fps: changes.fps ?? current.fps,
    loop: changes.loop ?? current.loop ?? true,
  };
  checkClip(newName, updated, frameCount);
  const next: Record<string, AnimationClip> = {};
  for (const [key, value] of Object.entries(clips)) {
    if (key === name) next[newName] = updated;
    else next[key] = value;
  }
  return next;
}

export function withoutClip(clips: Clips, name: string): Clips {
  if (!Object.hasOwn(clips, name)) throw new Error(`Clip "${name}" not found`);
  const next = { ...clips };
  delete next[name];
  return next;
}

/** The clips once a frame is inserted at `index`: later frames are numbered one higher. */
export function clipsAfterInsertingFrame(clips: Clips, index: number): Clips {
  return remap(clips, (frame) => (frame >= index ? frame + 1 : frame));
}

/** The clips once frame `index` is gone; throws when a clip would have no frames left. */
export function clipsAfterRemovingFrame(clips: Clips, index: number): Clips {
  for (const [name, clip] of Object.entries(clips)) {
    if (clip.frames.every((frame) => frame === index)) {
      throw new Error(`Frame ${index} is the only frame of clip "${name}"; remove the clip first`);
    }
  }
  const kept = remap(clips, (frame) => (frame === index ? null : frame > index ? frame - 1 : frame));
  return kept;
}

/** The clips once frames `a` and `b` trade places. */
export function clipsAfterSwappingFrames(clips: Clips, a: number, b: number): Clips {
  return remap(clips, (frame) => (frame === a ? b : frame === b ? a : frame));
}

function remap(clips: Clips, map: (frame: number) => number | null): Clips {
  const next: Record<string, AnimationClip> = {};
  for (const [name, clip] of Object.entries(clips)) {
    const frames: number[] = [];
    for (const frame of clip.frames) {
      const mapped = map(frame);
      if (mapped !== null) frames.push(mapped);
    }
    next[name] = { ...clip, frames };
  }
  return next;
}
