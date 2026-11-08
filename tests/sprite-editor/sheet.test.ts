import { describe, expect, it } from "vitest";
import { type Rgba } from "../../src/sprite-editor/color";
import { MAX_SIZE, Pixels } from "../../src/sprite-editor/pixels";
import {
  assembleSheet,
  checkClip,
  cleanClips,
  clipsAfterInsertingFrame,
  clipsAfterRemovingFrame,
  clipsAfterSwappingFrames,
  maxFrames,
  sheetColumns,
  splitSheet,
  withClipChanges,
  withNewClip,
  withoutClip,
} from "../../src/sprite-editor/sheet";

const RED: Rgba = [255, 0, 0, 255];

/** A w x h frame with its top-left pixel set to a color that encodes `tag`. */
function frame(w: number, h: number, tag: number): Pixels {
  const pixels = new Pixels(w, h);
  pixels.set(0, 0, [tag, 0, 0, 255]);
  return pixels;
}
const tagOf = (pixels: Pixels) => pixels.get(0, 0)[0];

describe("sheets", () => {
  it("splits a sheet into frames left to right, top to bottom, dropping leftovers", () => {
    const sheet = new Pixels(7, 5);
    sheet.set(0, 0, [1, 0, 0, 255]);
    sheet.set(3, 0, [2, 0, 0, 255]);
    sheet.set(0, 2, [3, 0, 0, 255]);
    sheet.set(3, 2, [4, 0, 0, 255]);
    sheet.set(6, 4, RED); // in the leftover strip
    const frames = splitSheet(sheet, 3, 2);
    expect(frames.map(tagOf)).toEqual([1, 2, 3, 4]);
    expect(frames.every((f) => f.width === 3 && f.height === 2)).toBe(true);
    expect(() => splitSheet(sheet, 8, 2)).toThrow("smaller than one 8x2 frame");
  });

  it("assembles frames into rows, wrapping at the biggest sheet, and round-trips", () => {
    const frames = [frame(3, 2, 1), frame(3, 2, 2), frame(3, 2, 3)];
    const sheet = assembleSheet(frames);
    expect([sheet.width, sheet.height]).toEqual([9, 2]);
    expect(splitSheet(sheet, 3, 2).map(tagOf)).toEqual([1, 2, 3]);
    expect(sheetColumns(16, 6)).toBe(6);
    expect(sheetColumns(16, 100)).toBe(32);
    expect(sheetColumns(MAX_SIZE, 3)).toBe(1);
    const many = Array.from({ length: 33 }, (_, i) => frame(16, 16, i));
    const wrapped = assembleSheet(many);
    expect([wrapped.width, wrapped.height]).toEqual([512, 32]);
    expect(splitSheet(wrapped, 16, 16).map(tagOf).slice(0, 33)).toEqual(many.map(tagOf));
    expect(maxFrames(16, 16)).toBe(1024);
    expect(maxFrames(MAX_SIZE, MAX_SIZE)).toBe(1);
    expect(() => assembleSheet([])).toThrow("at least one frame");
    expect(() => assembleSheet([frame(2, 2, 1), frame(3, 2, 2)])).toThrow("same size");
  });
});

describe("clips", () => {
  const clips = { walk: { frames: [1, 2, 3], fps: 8, loop: true }, idle: { frames: [0], fps: 2 } };

  it("checks a clip against the frame count", () => {
    expect(() => checkClip("walk", { frames: [0, 3], fps: 8 }, 4)).not.toThrow();
    expect(() => checkClip("walk", { frames: [], fps: 8 }, 4)).toThrow("at least one frame");
    expect(() => checkClip("walk", { frames: [4], fps: 8 }, 4)).toThrow("frame 4 doesn't exist (frames are numbered 0 to 3)");
    expect(() => checkClip("walk", { frames: [-1], fps: 8 }, 4)).toThrow("doesn't exist");
    expect(() => checkClip("walk", { frames: [1.5], fps: 8 }, 4)).toThrow("doesn't exist");
    expect(() => checkClip("walk", { frames: [0], fps: 0 }, 4)).toThrow("speed above 0");
    expect(() => checkClip("walk", { frames: [0], fps: NaN }, 4)).toThrow("speed above 0");
  });

  it("cleans stored clips of frames that don't exist, dropping empty or broken ones", () => {
    expect(cleanClips({ walk: { frames: [0, 5, 1], fps: 8 }, gone: { frames: [9], fps: 8 }, slow: { frames: [0], fps: 0 } }, 2)).toEqual({
      walk: { frames: [0, 1], fps: 8, loop: true },
    });
  });

  it("adds a clip with a free name playing the given frame", () => {
    const first = withNewClip({}, 2);
    expect(first).toEqual({ name: "clip", clips: { clip: { frames: [2], fps: 8, loop: true } } });
    expect(withNewClip(first.clips, 0).name).toBe("clip-2");
  });

  it("changes or renames a clip in place, refusing bad changes", () => {
    const renamed = withClipChanges(clips, "walk", { name: "run", fps: 12 }, 4);
    expect(Object.keys(renamed)).toEqual(["run", "idle"]);
    expect(renamed.run).toEqual({ frames: [1, 2, 3], fps: 12, loop: true });
    expect(withClipChanges(clips, "idle", { frames: [0, 1], loop: false }, 4).idle).toEqual({ frames: [0, 1], fps: 2, loop: false });
    expect(() => withClipChanges(clips, "walk", { name: "" }, 4)).toThrow("can't be empty");
    expect(() => withClipChanges(clips, "walk", { name: "idle" }, 4)).toThrow('"idle" already exists');
    expect(() => withClipChanges(clips, "walk", { frames: [7] }, 4)).toThrow("frame 7 doesn't exist");
    expect(() => withClipChanges(clips, "nope", {}, 4)).toThrow('"nope" not found');
    expect(clips.walk.frames).toEqual([1, 2, 3]); // untouched
  });

  it("removes a clip", () => {
    expect(Object.keys(withoutClip(clips, "walk"))).toEqual(["idle"]);
    expect(() => withoutClip(clips, "nope")).toThrow("not found");
  });

  it("renumbers frames when one is inserted, removed or swapped", () => {
    expect(clipsAfterInsertingFrame(clips, 2).walk.frames).toEqual([1, 3, 4]);
    expect(clipsAfterInsertingFrame(clips, 0).idle.frames).toEqual([1]);
    expect(clipsAfterRemovingFrame(clips, 2).walk.frames).toEqual([1, 2]);
    expect(clipsAfterRemovingFrame(clips, 2).idle.frames).toEqual([0]);
    expect(() => clipsAfterRemovingFrame(clips, 0)).toThrow('Frame 0 is the only frame of clip "idle"');
    const swapped = clipsAfterSwappingFrames(clips, 0, 1);
    expect(swapped.walk.frames).toEqual([0, 2, 3]);
    expect(swapped.idle.frames).toEqual([1]);
  });
});
