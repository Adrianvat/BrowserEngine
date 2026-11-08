import { describe, expect, it } from "vitest";
import { VectorDocument } from "../../../src/sprite-editor/vector/vector-document";
import { parseSvg } from "../../../src/sprite-editor/vector/svg";

function setup(width = 16, height = 16) {
  const doc = new VectorDocument(width, height);
  let changes = 0;
  doc.onChange(() => changes++);
  return { doc, changes: () => changes };
}

/** Drags a tool from (x0, y0) to (x1, y1). */
function drag(doc: VectorDocument, x0: number, y0: number, x1: number, y1: number, options = {}) {
  doc.beginStroke(x0, y0, options);
  doc.moveStroke(x1, y1);
  doc.endStroke();
}

describe("VectorDocument", () => {
  it("starts empty with the select tool and a black fill", () => {
    const { doc } = setup(8, 8);
    expect(doc.shapes).toEqual([]);
    expect(doc.tool).toBe("select");
    expect(doc.style).toEqual({ fill: "#000000", stroke: null, strokeWidth: 1 });
    expect(doc.snap).toBe(true);
    expect(doc.isSheet).toBe(false);
    expect(() => new VectorDocument(0, 4)).toThrow("at least 1");
  });

  it("draws rectangles, ellipses and lines by dragging, snapped to pixels, and selects them", () => {
    const { doc } = setup();
    doc.setTool("rect");
    doc.beginStroke(2.3, 2.4);
    doc.moveStroke(6.6, 5.2);
    expect(doc.draft).toMatchObject({ kind: "rect", x: 2, y: 2, width: 5, height: 3 });
    expect(doc.shapes).toHaveLength(0);
    doc.endStroke();
    expect(doc.draft).toBeNull();
    expect(doc.shapes[0]).toMatchObject({ kind: "rect", x: 2, y: 2, width: 5, height: 3, style: { fill: "#000000" } });
    expect(doc.selection).toEqual([doc.shapes[0]]);
    expect(doc.dirty).toBe(true);
    doc.setTool("ellipse");
    drag(doc, 8, 8, 0, 0);
    expect(doc.shapes[1]).toMatchObject({ kind: "ellipse", cx: 4, cy: 4, rx: 4, ry: 4 });
    doc.setTool("line");
    drag(doc, 0, 15, 15, 0);
    expect(doc.shapes[2]).toMatchObject({ kind: "line", x1: 0, y1: 15, x2: 15, y2: 0, style: { fill: null, stroke: "#000000" } });
    // A drag with no size makes nothing.
    doc.setTool("rect");
    drag(doc, 3, 3, 3.2, 3.1);
    expect(doc.shapes).toHaveLength(3);
    expect(doc.canUndo).toBe(true);
    doc.undo();
    expect(doc.shapes).toHaveLength(2);
    doc.redo();
    expect(doc.shapes).toHaveLength(3);
  });

  it("draws free-form with the pen, simplified, and polygons by clicking points", () => {
    const { doc } = setup();
    doc.setTool("pen");
    doc.beginStroke(0, 0);
    for (let i = 1; i <= 10; i++) doc.moveStroke(i, 0.1 * (i % 2));
    for (let i = 1; i <= 10; i++) doc.moveStroke(10, i);
    doc.endStroke();
    expect(doc.shapes[0]).toMatchObject({ kind: "path", closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
    doc.setTool("polygon");
    doc.beginStroke(2, 2);
    doc.endStroke();
    doc.beginStroke(8, 2);
    doc.endStroke();
    doc.moveStroke(5, 7);
    expect(doc.polygon).toEqual([{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 5, y: 7 }]);
    expect(doc.shapes).toHaveLength(1);
    doc.beginStroke(5, 7);
    doc.endStroke();
    doc.beginStroke(2.2, 2.1); // back on the first point closes it
    expect(doc.polygon).toBeNull();
    expect(doc.shapes[1]).toMatchObject({ kind: "path", closed: true, points: [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 5, y: 7 }] });
    // Enter finishes too; two points make a line; Escape drops it.
    doc.beginStroke(0, 10);
    doc.beginStroke(10, 10);
    doc.finishPolygon();
    expect(doc.shapes[2]).toMatchObject({ kind: "line", x1: 0, y1: 10, x2: 10, y2: 10 });
    doc.beginStroke(1, 1);
    doc.cancelDraft();
    expect(doc.polygon).toBeNull();
    expect(doc.shapes).toHaveLength(3);
  });

  it("selects by click, shift-click and marquee, and moves the selection by dragging", () => {
    const { doc } = setup();
    doc.setTool("rect");
    drag(doc, 0, 0, 4, 4);
    drag(doc, 8, 8, 12, 12);
    const [a, b] = doc.shapes;
    doc.setTool("select");
    doc.beginStroke(14, 14);
    doc.endStroke(); // click on nothing
    expect(doc.selection).toEqual([]);
    doc.beginStroke(2, 2);
    doc.endStroke();
    expect(doc.selection.map((s) => s.id)).toEqual([a.id]);
    doc.beginStroke(10, 10, { shift: true });
    doc.endStroke();
    expect(doc.selection.map((s) => s.id)).toEqual([a.id, b.id]);
    doc.beginStroke(10, 10, { shift: true });
    doc.endStroke(); // shift-click on a selected shape takes it out
    expect(doc.selection.map((s) => s.id)).toEqual([a.id]);
    // Drag the first rectangle by 3, 1.
    drag(doc, 1, 1, 4.2, 2.4);
    expect(doc.shapes[0]).toMatchObject({ x: 3, y: 1, width: 4, height: 4 });
    expect(doc.shapes[1]).toMatchObject({ x: 8, y: 8 });
    expect(doc.selection.map((s) => s.id)).toEqual([a.id]);
    doc.undo();
    expect(doc.shapes[0]).toMatchObject({ x: 0, y: 0 });
    // Marquee around both.
    drag(doc, 15, 15, 1, 1);
    expect(doc.selection.map((s) => s.id)).toEqual([a.id, b.id]);
    doc.beginStroke(15, 2);
    doc.endStroke();
    expect(doc.selection).toEqual([]);
  });

  it("resizes the selection by a handle, and restyles, reorders, duplicates and deletes it", () => {
    const { doc } = setup();
    doc.setTool("rect");
    drag(doc, 0, 0, 4, 4);
    doc.setTool("select");
    doc.beginStroke(4, 4, { handle: "se" });
    doc.moveStroke(8, 6);
    doc.endStroke();
    expect(doc.shapes[0]).toMatchObject({ x: 0, y: 0, width: 8, height: 6 });
    doc.beginStroke(0, 0, { handle: "nw" });
    doc.moveStroke(20, 20); // can't cross the far side
    doc.endStroke();
    expect(doc.shapes[0]).toMatchObject({ x: 7, y: 5, width: 1, height: 1 });
    doc.undo();
    doc.undo();
    expect(doc.shapes[0]).toMatchObject({ width: 4, height: 4 });
    expect(doc.selection).toEqual([]); // undo drops the selection

    doc.selectAll();
    doc.setStyle({ fill: "#ff0000", stroke: "#00ff00", strokeWidth: 2 });
    expect(doc.shapes[0].style).toEqual({ fill: "#ff0000", stroke: "#00ff00", strokeWidth: 2 });
    expect(doc.style.fill).toBe("#ff0000");
    doc.duplicateSelection();
    expect(doc.shapes).toHaveLength(2);
    expect(doc.selection[0].id).toBe(doc.shapes[1].id);
    expect(doc.shapes[1].id).not.toBe(doc.shapes[0].id);
    doc.moveSelection(8, 8);
    expect(doc.shapes[1]).toMatchObject({ x: 8, y: 8 });
    doc.sendBackward();
    expect(doc.shapes[0]).toMatchObject({ x: 8, y: 8 });
    doc.sendBackward(); // already at the back: nothing, no undo step
    doc.bringForward();
    expect(doc.shapes[1]).toMatchObject({ x: 8, y: 8 });
    doc.deleteSelection();
    expect(doc.shapes).toHaveLength(1);
    doc.selectAll();
    expect(doc.selection).toHaveLength(1);
    // Selecting a shape shows its style for the next shape.
    doc.setStyle({ fill: "#0000ff" });
    doc.deselect();
    doc.setTool("rect");
    drag(doc, 10, 10, 12, 12);
    expect(doc.shapes[1].style.fill).toBe("#0000ff");
  });

  it("centers the selection and nudges it", () => {
    const { doc } = setup(16, 16);
    doc.setTool("rect");
    drag(doc, 0, 0, 4, 2);
    doc.centerSelection();
    expect(doc.shapes[0]).toMatchObject({ x: 6, y: 7 });
    doc.moveSelection(-1, 0);
    expect(doc.shapes[0]).toMatchObject({ x: 5, y: 7 });
  });

  it("keeps frames and their sizes in the undo history, and copies frames with fresh ids", () => {
    const { doc } = setup(8, 8);
    doc.setTool("rect");
    drag(doc, 0, 0, 2, 2);
    doc.duplicateFrame();
    expect(doc.frameCount).toBe(2);
    expect(doc.shapes[0].id).not.toBe(doc.frames[0].shapes[0].id);
    expect(doc.selection).toEqual([]);
    doc.resize(10, 12);
    expect([doc.width, doc.height]).toEqual([10, 12]);
    expect(doc.frames.every((f) => f.width === 10)).toBe(true);
    doc.undo();
    expect([doc.width, doc.height]).toEqual([8, 8]);
    doc.setFrame(0);
    doc.clear();
    expect(doc.shapes).toEqual([]);
    doc.undo();
    expect(doc.shapes).toHaveLength(1);
    expect(doc.isSheet).toBe(true);
  });

  it("saves a single image or a sheet as SVG, and opens it again", () => {
    const { doc } = setup(8, 8);
    doc.setTool("rect");
    drag(doc, 1, 1, 3, 3);
    doc.setCrispEdges(true);
    const single = doc.toSvg();
    expect(single).toContain('width="8" height="8"');
    expect(single).toContain('<rect x="1" y="1" width="2" height="2" fill="#000000" />');
    expect(single).toContain("crispEdges");
    doc.addFrame();
    drag(doc, 4, 4, 6, 6);
    doc.addClip();
    const sheetText = doc.toSvg();
    expect(sheetText).toContain('width="16" height="8"');
    expect(doc.sheet).toEqual({ frameWidth: 8, frameHeight: 8, animations: { clip: { frames: [1], fps: 8, loop: true } } });

    const other = new VectorDocument();
    const notes = other.openSvg(sheetText, "thing", "thing", doc.sheet);
    expect(notes).toEqual([]);
    expect(other.frameCount).toBe(2);
    expect([other.width, other.height]).toEqual([8, 8]);
    expect(other.frames[1].shapes[0]).toMatchObject({ kind: "rect", x: 4, y: 4 });
    expect(other.crispEdges).toBe(true);
    expect(Object.keys(other.clips)).toEqual(["clip"]);
    expect(other.dirty).toBe(false);
    expect(other.openedFrom).toBe("thing");
    other.openSvg(single, "one", null);
    expect(other.frameCount).toBe(1);
    expect(other.isSheet).toBe(false);
    expect(() => other.openSvg("<svg/>", "bad", null)).toThrow("width and height");
  });

  it("opens parsed images and refuses sizes the editor can't show", () => {
    const { doc } = setup();
    const image = parseSvg('<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="4"><rect width="1" height="1"/></svg>');
    expect(() => doc.open(image, "wide", null)).toThrow("at most 4096");
    const big = parseSvg('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="1" height="1"/></svg>');
    doc.open(big, "background", null);
    expect([doc.width, doc.height]).toEqual([800, 600]);
    doc.addFrame();
    expect(doc.frameCount).toBe(2);
    doc.reset(4, 4, "fresh");
    expect(doc.name).toBe("fresh");
    expect(doc.shapes).toEqual([]);
  });
});
