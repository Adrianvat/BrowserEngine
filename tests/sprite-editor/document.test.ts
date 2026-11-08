import { describe, expect, it } from "vitest";
import { TRANSPARENT, type Rgba } from "../../src/sprite-editor/color";
import { MAX_BRUSH, SpriteDocument } from "../../src/sprite-editor/document";
import { Pixels } from "../../src/sprite-editor/pixels";

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];

function painted(doc: SpriteDocument): [number, number][] {
  const points: [number, number][] = [];
  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) if (doc.pixels.get(x, y)[3] !== 0) points.push([x, y]);
  }
  return points;
}

function setup(width = 8, height = 8) {
  const doc = new SpriteDocument(width, height);
  doc.setColor(RED);
  let changes = 0;
  doc.onChange(() => changes++);
  return { doc, changes: () => changes };
}

describe("SpriteDocument", () => {
  it("starts blank, clean, with a brush of size 1", () => {
    const { doc } = setup(4, 3);
    expect(doc.width).toBe(4);
    expect(doc.height).toBe(3);
    expect(doc.tool).toBe("brush");
    expect(doc.brushSize).toBe(1);
    expect(doc.dirty).toBe(false);
    expect(doc.name).toBe("");
    expect(doc.openedFrom).toBeNull();
    expect(doc.pixels.isBlank()).toBe(true);
  });

  it("paints a stroke as a joined line and makes the sprite dirty", () => {
    const { doc, changes } = setup();
    doc.beginStroke(0, 0);
    expect(doc.drawing).toBe(true);
    doc.moveStroke(3, 0);
    doc.endStroke();
    expect(doc.drawing).toBe(false);
    expect(painted(doc)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(doc.pixels.get(2, 0)).toEqual(RED);
    expect(doc.dirty).toBe(true);
    expect(changes()).toBeGreaterThan(0);
  });

  it("uses the brush size and keeps a color opaque", () => {
    const { doc } = setup();
    doc.setColor([1, 2, 3, 0]);
    expect(doc.color).toEqual([1, 2, 3, 255]);
    doc.setBrushSize(2);
    doc.beginStroke(0, 0);
    doc.endStroke();
    expect(painted(doc)).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
    doc.setBrushSize(0);
    expect(doc.brushSize).toBe(1);
    doc.setBrushSize(99);
    expect(doc.brushSize).toBe(MAX_BRUSH);
  });

  it("erases with the eraser tool and with the eraser as a one-off", () => {
    const { doc } = setup();
    doc.beginStroke(0, 0);
    doc.moveStroke(3, 0);
    doc.endStroke();
    doc.setTool("eraser");
    doc.beginStroke(1, 0);
    doc.endStroke();
    expect(painted(doc)).toEqual([[0, 0], [2, 0], [3, 0]]);
    doc.setTool("brush");
    doc.beginStroke(3, 0, "eraser");
    doc.endStroke();
    expect(painted(doc)).toEqual([[0, 0], [2, 0]]);
    expect(doc.tool).toBe("brush");
  });

  it("fills on the press only", () => {
    const { doc } = setup(3, 1);
    doc.beginStroke(0, 0);
    doc.moveStroke(2, 0);
    doc.endStroke();
    doc.setColor(BLUE);
    doc.setTool("fill");
    doc.beginStroke(1, 0);
    doc.moveStroke(5, 5);
    doc.endStroke();
    expect(doc.pixels.get(0, 0)).toEqual(BLUE);
    expect(doc.pixels.get(2, 0)).toEqual(BLUE);
  });

  it("picks a color from an opaque pixel, leaving the pixels alone", () => {
    const { doc } = setup();
    doc.beginStroke(2, 2);
    doc.endStroke();
    doc.setColor(BLUE);
    doc.setTool("picker");
    doc.beginStroke(0, 0);
    doc.endStroke();
    expect(doc.color).toEqual(BLUE);
    doc.beginStroke(2, 2);
    doc.endStroke();
    expect(doc.color).toEqual(RED);
    expect(doc.canUndo).toBe(true); // only the first stroke
    doc.undo();
    expect(doc.canUndo).toBe(false);
    // Alt-click picks whatever the tool.
    doc.setTool("brush");
    doc.setColor(BLUE);
    doc.beginStroke(5, 5);
    doc.endStroke();
    doc.setColor(RED);
    doc.beginStroke(5, 5, "picker");
    doc.endStroke();
    expect(doc.color).toEqual(BLUE);
    expect(doc.pixels.get(5, 5)).toEqual(BLUE);
  });

  it("continues a line through positions outside the sprite", () => {
    const { doc } = setup(4, 1);
    doc.beginStroke(-3, 0);
    doc.moveStroke(1, 0);
    doc.endStroke();
    expect(painted(doc)).toEqual([[0, 0], [1, 0]]);
  });

  it("keeps using the tool the stroke started with", () => {
    const { doc } = setup(4, 1);
    doc.beginStroke(0, 0);
    doc.setTool("eraser");
    doc.moveStroke(3, 0);
    doc.endStroke();
    expect(painted(doc)).toHaveLength(4);
  });

  it("undoes and redoes one stroke at a time; strokes that changed nothing aren't steps", () => {
    const { doc } = setup(4, 1);
    doc.beginStroke(0, 0);
    doc.endStroke();
    doc.beginStroke(1, 0);
    doc.endStroke();
    doc.beginStroke(1, 0); // same color again
    doc.endStroke();
    doc.beginStroke(9, 9); // outside
    doc.endStroke();
    expect(doc.canUndo).toBe(true);
    doc.undo();
    expect(painted(doc)).toEqual([[0, 0]]);
    doc.undo();
    expect(painted(doc)).toEqual([]);
    expect(doc.canUndo).toBe(false);
    doc.redo();
    expect(painted(doc)).toEqual([[0, 0]]);
    doc.redo();
    expect(painted(doc)).toEqual([[0, 0], [1, 0]]);
    expect(doc.canRedo).toBe(false);
  });

  it("ends a stroke in progress when undoing", () => {
    const { doc } = setup(4, 1);
    doc.beginStroke(0, 0);
    doc.undo();
    expect(doc.drawing).toBe(false);
    expect(painted(doc)).toEqual([]);
  });

  it("clears and resizes as undo steps", () => {
    const { doc } = setup(2, 2);
    doc.beginStroke(1, 1);
    doc.endStroke();
    doc.resize(3, 1);
    expect(doc.width).toBe(3);
    expect(painted(doc)).toEqual([]);
    doc.undo();
    expect(doc.height).toBe(2);
    expect(painted(doc)).toEqual([[1, 1]]);
    doc.resize(2, 2); // no change, no step
    doc.clear();
    expect(doc.pixels.isBlank()).toBe(true);
    doc.clear(); // already blank, no step
    doc.undo();
    expect(painted(doc)).toEqual([[1, 1]]);
    doc.undo(); // the stroke
    expect(painted(doc)).toEqual([]);
    expect(doc.canUndo).toBe(false);
    expect(() => doc.resize(0, 1)).toThrow("at least 1");
  });

  it("opens pixels as a copy, remembers where from, and is clean again after a save", () => {
    const { doc } = setup();
    const source = new Pixels(2, 2);
    source.set(0, 0, BLUE);
    doc.open(source, "slime", "slime");
    expect(doc.width).toBe(2);
    expect(doc.name).toBe("slime");
    expect(doc.openedFrom).toBe("slime");
    expect(doc.dirty).toBe(false);
    expect(doc.canUndo).toBe(false);
    doc.beginStroke(1, 1);
    doc.endStroke();
    expect(source.get(1, 1)).toEqual(TRANSPARENT);
    expect(doc.dirty).toBe(true);
    doc.setName("slime-2");
    doc.saved("slime-2");
    expect(doc.dirty).toBe(false);
    expect(doc.openedFrom).toBe("slime-2");
    doc.reset(4, 4);
    expect(doc.width).toBe(4);
    expect(doc.name).toBe("");
    expect(doc.openedFrom).toBeNull();
    expect(doc.canUndo).toBe(false);
  });

  describe("selection", () => {
    /** A 6x4 sprite with a red 2x2 block at (1, 1). */
    const withBlock = () => {
      const { doc } = setup(6, 4);
      doc.setBrushSize(2);
      doc.beginStroke(1, 1);
      doc.endStroke();
      doc.setBrushSize(1);
      expect(painted(doc)).toEqual([[1, 1], [2, 1], [1, 2], [2, 2]]);
      doc.setTool("select");
      return doc;
    };

    it("drags out a rectangle, clamped to the sprite; a plain click selects nothing", () => {
      const doc = withBlock();
      doc.beginStroke(4, 3);
      doc.moveStroke(-5, 0);
      expect(doc.selection).toEqual({ x: 0, y: 0, width: 5, height: 4 });
      doc.moveStroke(1, 1);
      doc.endStroke();
      expect(doc.selection).toEqual({ x: 1, y: 1, width: 4, height: 3 });
      expect(doc.dirty).toBe(true); // from the block, not the selection
      expect(doc.canUndo).toBe(true);
      doc.beginStroke(5, 0);
      doc.endStroke();
      expect(doc.selection).toBeNull();
      doc.selectAll();
      expect(doc.selection).toEqual({ x: 0, y: 0, width: 6, height: 4 });
      doc.select({ x: 4, y: 2, width: 10, height: 10 });
      expect(doc.selection).toEqual({ x: 4, y: 2, width: 2, height: 2 });
      doc.select({ x: 9, y: 9, width: 2, height: 2 });
      expect(doc.selection).toBeNull();
    });

    it("moves the selected pixels by dragging inside the selection, as one undo step", () => {
      const doc = withBlock();
      doc.select({ x: 1, y: 1, width: 2, height: 2 });
      doc.beginStroke(2, 2);
      doc.moveStroke(3, 2);
      expect(doc.floating).toBe(true);
      expect(doc.selection).toEqual({ x: 2, y: 1, width: 2, height: 2 });
      expect(painted(doc)).toEqual([[2, 1], [3, 1], [2, 2], [3, 2]]);
      doc.moveStroke(4, 2);
      doc.endStroke();
      expect(doc.floating).toBe(true);
      // A second drag continues the same move.
      doc.beginStroke(4, 1);
      doc.moveStroke(4, 2);
      doc.endStroke();
      expect(doc.selection).toEqual({ x: 3, y: 2, width: 2, height: 2 });
      expect(painted(doc)).toEqual([[3, 2], [4, 2], [3, 3], [4, 3]]);
      doc.deselect();
      expect(doc.floating).toBe(false);
      expect(doc.selection).toBeNull();
      expect(painted(doc)).toEqual([[3, 2], [4, 2], [3, 3], [4, 3]]);
      doc.undo();
      expect(painted(doc)).toEqual([[1, 1], [2, 1], [1, 2], [2, 2]]);
      doc.redo();
      expect(painted(doc)).toEqual([[3, 2], [4, 2], [3, 3], [4, 3]]);
    });

    it("lets moved pixels pass over others without erasing them, and loses what leaves the sprite", () => {
      const doc = withBlock();
      doc.setTool("brush");
      doc.setColor(BLUE);
      doc.beginStroke(3, 1);
      doc.endStroke();
      // The red block with a transparent column to its left.
      doc.select({ x: 0, y: 0, width: 3, height: 3 });
      doc.moveSelection(3, 0);
      // The blue pixel shows through the transparent column; the block sits right of it.
      expect(doc.pixels.get(3, 1)).toEqual(BLUE);
      expect(doc.pixels.get(4, 1)).toEqual(RED);
      expect(painted(doc)).toEqual([[3, 1], [4, 1], [5, 1], [4, 2], [5, 2]]);
      doc.commitSelection();
      expect(doc.selection).toEqual({ x: 3, y: 0, width: 3, height: 3 });
      expect(doc.floating).toBe(false);
      // Moving the block half off the right edge and putting it down loses that half.
      doc.select({ x: 4, y: 1, width: 2, height: 2 });
      doc.moveSelection(1, 0);
      expect(doc.selection).toEqual({ x: 5, y: 1, width: 2, height: 2 });
      doc.commitSelection();
      expect(doc.selection).toEqual({ x: 5, y: 1, width: 1, height: 2 });
      expect(painted(doc)).toEqual([[3, 1], [5, 1], [5, 2]]);
      doc.undo();
      expect(painted(doc)).toEqual([[3, 1], [4, 1], [5, 1], [4, 2], [5, 2]]);
    });

    it("centers the selected content", () => {
      const doc = withBlock();
      doc.selectAll();
      doc.centerSelection();
      expect(doc.floating).toBe(true);
      expect(painted(doc)).toEqual([[2, 1], [3, 1], [2, 2], [3, 2]]);
      doc.deselect();
      doc.undo();
      expect(painted(doc)).toEqual([[1, 1], [2, 1], [1, 2], [2, 2]]);
      // Centering a selection with nothing in it does nothing, not even an undo step.
      doc.undo();
      expect(doc.canUndo).toBe(false);
      doc.select({ x: 4, y: 0, width: 2, height: 2 });
      doc.centerSelection();
      expect(doc.floating).toBe(false);
      expect(doc.canUndo).toBe(false);
    });

    it("deletes the selected pixels, before or during a move", () => {
      const doc = withBlock();
      doc.select({ x: 1, y: 1, width: 1, height: 2 });
      doc.deleteSelection();
      expect(painted(doc)).toEqual([[2, 1], [2, 2]]);
      expect(doc.selection).toEqual({ x: 1, y: 1, width: 1, height: 2 });
      doc.undo();
      expect(painted(doc)).toHaveLength(4);
      doc.select({ x: 2, y: 1, width: 1, height: 2 });
      doc.moveSelection(1, 0);
      doc.deleteSelection();
      expect(doc.floating).toBe(false);
      expect(painted(doc)).toEqual([[1, 1], [1, 2]]);
      doc.undo();
      expect(painted(doc)).toHaveLength(4);
    });

    it("puts a moved selection down before painting, clearing, resizing or undoing", () => {
      const doc = withBlock();
      doc.selectAll();
      doc.moveSelection(1, 0);
      doc.setTool("brush");
      doc.beginStroke(0, 0);
      doc.endStroke();
      expect(doc.selection).toBeNull();
      expect(painted(doc)).toEqual([[0, 0], [2, 1], [3, 1], [2, 2], [3, 2]]);
      doc.undo(); // the stroke
      doc.undo(); // the move
      expect(painted(doc)).toEqual([[1, 1], [2, 1], [1, 2], [2, 2]]);

      doc.selectAll();
      doc.moveSelection(0, 1);
      doc.resize(3, 4);
      expect(doc.selection).toBeNull();
      expect(painted(doc)).toEqual([[1, 2], [2, 2], [1, 3], [2, 3]]);
      doc.undo(); // the resize
      expect(doc.width).toBe(6);
      doc.undo(); // the move
      expect(painted(doc)).toEqual([[1, 1], [2, 1], [1, 2], [2, 2]]);

      doc.selectAll();
      doc.moveSelection(0, 1);
      doc.clear();
      expect(doc.pixels.isBlank()).toBe(true);
      doc.undo();
      expect(painted(doc)).toEqual([[1, 2], [2, 2], [1, 3], [2, 3]]);
    });

    it("forgets the selection when a sprite is opened or reset", () => {
      const doc = withBlock();
      doc.selectAll();
      doc.moveSelection(1, 1);
      doc.reset(4, 4);
      expect(doc.selection).toBeNull();
      expect(doc.floating).toBe(false);
      expect(doc.pixels.isBlank()).toBe(true);
    });

    it("picks colors from the moved pixels too", () => {
      const doc = withBlock();
      doc.selectAll();
      doc.moveSelection(2, 0);
      doc.setColor(BLUE);
      doc.beginStroke(3, 1, "picker");
      expect(doc.color).toEqual(RED);
      expect(doc.floating).toBe(true);
    });
  });

  describe("frames and clips", () => {
    it("starts as a single frame and becomes a sheet once frames or clips are added", () => {
      const { doc } = setup(4, 4);
      expect(doc.frameCount).toBe(1);
      expect(doc.frame).toBe(0);
      expect(doc.isSheet).toBe(false);
      expect(doc.toSheet().sheet).toBeNull();
      doc.addFrame();
      expect(doc.frameCount).toBe(2);
      expect(doc.frame).toBe(1);
      expect(doc.isSheet).toBe(true);
      expect(doc.dirty).toBe(true);
      doc.undo();
      expect(doc.frameCount).toBe(1);
      expect(doc.isSheet).toBe(true); // once a sheet, always saved as one
    });

    it("draws on the current frame only, and undo goes back to the frame it changed", () => {
      const { doc } = setup(4, 4);
      doc.beginStroke(0, 0);
      doc.endStroke();
      doc.addFrame();
      expect(doc.pixels.isBlank()).toBe(true);
      doc.beginStroke(1, 1);
      doc.endStroke();
      expect(painted(doc)).toEqual([[1, 1]]);
      doc.setFrame(0);
      expect(painted(doc)).toEqual([[0, 0]]);
      expect(doc.frames[1].get(1, 1)).toEqual(RED);
      doc.undo(); // the stroke on frame 1
      expect(doc.frame).toBe(1);
      expect(doc.pixels.isBlank()).toBe(true);
      expect(doc.frames[0].get(0, 0)).toEqual(RED);
      doc.redo();
      expect(painted(doc)).toEqual([[1, 1]]);
      doc.setFrame(9); // ignored
      expect(doc.frame).toBe(1);
    });

    it("never changes a frame another undo state holds", () => {
      const { doc } = setup(4, 4);
      doc.beginStroke(0, 0);
      doc.endStroke();
      doc.duplicateFrame();
      doc.beginStroke(3, 3); // on the copy
      doc.endStroke();
      doc.setFrame(0);
      doc.beginStroke(1, 0);
      doc.endStroke();
      doc.undo(); // frame 0 stroke
      doc.undo(); // frame 1 stroke
      doc.undo(); // duplicate
      expect(doc.frameCount).toBe(1);
      expect(painted(doc)).toEqual([[0, 0]]);
      doc.redo();
      doc.redo();
      doc.redo();
      expect(doc.frame).toBe(0);
      expect(painted(doc)).toEqual([[0, 0], [1, 0]]);
      expect(doc.frames[1].get(3, 3)).toEqual(RED);
      expect(doc.frames[1].get(1, 0)[3]).toBe(0);
    });

    it("duplicates, removes and reorders frames, keeping clips pointing at the same pictures", () => {
      const { doc } = setup(4, 4);
      doc.beginStroke(0, 0);
      doc.endStroke();
      doc.duplicateFrame(); // frame 1 = copy
      expect(doc.frame).toBe(1);
      expect(painted(doc)).toEqual([[0, 0]]);
      doc.setTool("eraser");
      doc.beginStroke(0, 0);
      doc.endStroke();
      doc.addFrame(); // frame 2 blank
      const name = doc.addClip();
      expect(name).toBe("clip");
      doc.updateClip("clip", { frames: [0, 2] });
      doc.setFrame(1);
      doc.removeFrame(); // the erased copy
      expect(doc.frameCount).toBe(2);
      expect(doc.frame).toBe(1);
      expect(doc.clips.clip.frames).toEqual([0, 1]);
      doc.moveFrame(-1);
      expect(doc.frame).toBe(0);
      expect(doc.frames[1].get(0, 0)).toEqual(RED);
      expect(doc.clips.clip.frames).toEqual([1, 0]);
      doc.moveFrame(-1); // already first: nothing
      expect(doc.frame).toBe(0);
      doc.undo();
      expect(doc.clips.clip.frames).toEqual([0, 1]);
      expect(doc.frame).toBe(1);
    });

    it("refuses to remove the last frame or a clip's only frame", () => {
      const { doc } = setup(4, 4);
      expect(() => doc.removeFrame()).toThrow("at least one frame");
      doc.addFrame();
      doc.addClip(); // plays frame 1
      expect(() => doc.removeFrame()).toThrow('only frame of clip "clip"');
      expect(doc.frameCount).toBe(2);
      doc.removeClip("clip");
      doc.removeFrame();
      expect(doc.frameCount).toBe(1);
    });

    it("limits the number of frames a sheet can hold", () => {
      const { doc } = setup(512, 512);
      expect(() => doc.addFrame()).toThrow("at most 1 frames");
      expect(doc.frameCount).toBe(1);
    });

    it("edits clips as undo steps and refuses changes that couldn't play", () => {
      const { doc } = setup(4, 4);
      doc.addFrame();
      doc.addClip();
      doc.addClip();
      expect(Object.keys(doc.clips)).toEqual(["clip", "clip-2"]);
      doc.updateClip("clip", { name: "walk", frames: [0, 1], fps: 12, loop: false });
      expect(Object.keys(doc.clips)).toEqual(["walk", "clip-2"]);
      expect(doc.clips.walk).toEqual({ frames: [0, 1], fps: 12, loop: false });
      expect(() => doc.updateClip("walk", { frames: [5] })).toThrow("frame 5 doesn't exist");
      expect(() => doc.updateClip("walk", { name: "clip-2" })).toThrow("already exists");
      expect(doc.clips.walk.frames).toEqual([0, 1]);
      doc.removeClip("clip-2");
      expect(Object.keys(doc.clips)).toEqual(["walk"]);
      doc.undo();
      expect(Object.keys(doc.clips)).toEqual(["walk", "clip-2"]);
      doc.undo();
      expect(Object.keys(doc.clips)).toEqual(["clip", "clip-2"]);
      expect(doc.toSheet().sheet?.animations).toEqual(doc.clips);
    });

    it("resizes every frame and clears only the current one", () => {
      const { doc } = setup(2, 2);
      doc.beginStroke(1, 1);
      doc.endStroke();
      doc.duplicateFrame();
      doc.resize(3, 3);
      expect(doc.frames.every((f) => f.width === 3 && f.height === 3)).toBe(true);
      expect(doc.frames[0].get(1, 1)).toEqual(RED);
      doc.clear();
      expect(doc.frames[1].isBlank()).toBe(true);
      expect(doc.frames[0].isBlank()).toBe(false);
      doc.undo();
      expect(doc.frames[1].isBlank()).toBe(false);
      doc.undo();
      expect(doc.width).toBe(2);
    });

    it("opens a sheet as frames with its clips, and saves it back as one image", () => {
      const { doc } = setup();
      const sheet = new Pixels(4, 2);
      sheet.set(0, 0, RED);
      sheet.set(3, 1, BLUE);
      doc.open(sheet, "slime", "slime", {
        frameWidth: 2,
        frameHeight: 2,
        animations: { wobble: { frames: [0, 1], fps: 4 }, broken: { frames: [7], fps: 4 } },
      });
      expect(doc.frameCount).toBe(2);
      expect(doc.width).toBe(2);
      expect(doc.isSheet).toBe(true);
      expect(doc.frames[0].get(0, 0)).toEqual(RED);
      expect(doc.frames[1].get(1, 1)).toEqual(BLUE);
      expect(Object.keys(doc.clips)).toEqual(["wobble"]);
      expect(doc.dirty).toBe(false);
      const saved = doc.toSheet();
      expect(saved.pixels.equals(sheet)).toBe(true);
      expect(saved.sheet).toEqual({
        frameWidth: 2,
        frameHeight: 2,
        animations: { wobble: { frames: [0, 1], fps: 4, loop: true } },
      });
      // A sheet with one frame and no clips still saves as a sheet, so its frame size is kept.
      doc.open(new Pixels(2, 2), "one", "one", { frameWidth: 2, frameHeight: 2, animations: {} });
      expect(doc.toSheet().sheet).toEqual({ frameWidth: 2, frameHeight: 2, animations: {} });
      expect(() => doc.open(new Pixels(1, 1), "tiny", null, { frameWidth: 2, frameHeight: 2, animations: {} })).toThrow(
        "smaller than one 2x2 frame",
      );
    });

    it("includes a lifted selection where it is when saving, and puts it down when switching frames", () => {
      const { doc } = setup(4, 1);
      doc.beginStroke(0, 0);
      doc.endStroke();
      doc.addFrame();
      doc.setFrame(0);
      doc.selectAll();
      doc.moveSelection(2, 0);
      expect(doc.floating).toBe(true);
      const saved = doc.toSheet();
      expect(saved.pixels.get(2, 0)).toEqual(RED);
      expect(saved.pixels.get(0, 0)[3]).toBe(0);
      expect(doc.floating).toBe(true);
      doc.setFrame(1);
      expect(doc.floating).toBe(false);
      expect(doc.selection).toBeNull();
      expect(doc.frames[0].get(2, 0)).toEqual(RED);
    });
  });
});
