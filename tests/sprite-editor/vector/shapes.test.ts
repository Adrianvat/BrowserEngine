import { describe, expect, it } from "vitest";
import { Pixels } from "../../../src/sprite-editor/pixels";
import { pixelsToShapes } from "../../../src/sprite-editor/vector/convert";
import {
  hitShape,
  shapeBounds,
  shapeInRect,
  shapesBounds,
  simplifyPoints,
  snapShape,
  stretchShape,
  translateShape,
  type Shape,
} from "../../../src/sprite-editor/vector/shapes";

const filled = { fill: "#ff0000", stroke: null, strokeWidth: 1 };
const hollow = { fill: null, stroke: "#000000", strokeWidth: 2 };
const rect: Shape = { id: 1, style: filled, kind: "rect", x: 2, y: 2, width: 4, height: 2 };
const ellipse: Shape = { id: 2, style: filled, kind: "ellipse", cx: 5, cy: 5, rx: 3, ry: 2 };
const line: Shape = { id: 3, style: hollow, kind: "line", x1: 0, y1: 0, x2: 10, y2: 0 };
const triangle: Shape = { id: 4, style: filled, kind: "path", points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }], closed: true };

describe("shape geometry", () => {
  it("knows every shape's box", () => {
    expect(shapeBounds(rect)).toEqual({ x: 2, y: 2, width: 4, height: 2 });
    expect(shapeBounds(ellipse)).toEqual({ x: 2, y: 3, width: 6, height: 4 });
    expect(shapeBounds(line)).toEqual({ x: 0, y: 0, width: 10, height: 0 });
    expect(shapeBounds(triangle)).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    expect(shapesBounds([rect, ellipse])).toEqual({ x: 2, y: 2, width: 6, height: 5 });
    expect(shapesBounds([])).toBeNull();
  });

  it("moves and stretches shapes, as new objects", () => {
    const moved = translateShape(rect, 1, -1);
    expect(moved).toMatchObject({ x: 3, y: 1, width: 4, height: 2, id: 1 });
    expect(moved).not.toBe(rect);
    const from = { x: 0, y: 0, width: 8, height: 8 };
    const to = { x: 4, y: 0, width: 16, height: 4 };
    expect(stretchShape(triangle, from, to)).toMatchObject({ points: [{ x: 4, y: 0 }, { x: 20, y: 0 }, { x: 4, y: 4 }] });
    expect(stretchShape(ellipse, from, to)).toMatchObject({ cx: 14, cy: 2.5, rx: 6, ry: 1 });
    expect(stretchShape(rect, from, to)).toMatchObject({ x: 8, y: 1, width: 8, height: 1 });
    // A flat box (a horizontal line) isn't stretched vertically, only moved.
    expect(stretchShape(line, { x: 0, y: 0, width: 10, height: 0 }, { x: 0, y: 5, width: 20, height: 0 })).toMatchObject({ x2: 20, y1: 5, y2: 5 });
  });

  it("snaps to whole pixels without collapsing", () => {
    expect(snapShape({ ...rect, x: 1.4, width: 0.2 })).toMatchObject({ x: 1, width: 1 });
    expect(snapShape({ ...ellipse, cx: 5.3, rx: 0.2 })).toMatchObject({ cx: 5.5, rx: 0.5 });
    expect(snapShape({ ...triangle, points: [{ x: 0.6, y: 0.4 }] })).toMatchObject({ points: [{ x: 1, y: 0 }] });
  });

  it("hits fills inside, strokes near the edge, and nothing elsewhere", () => {
    expect(hitShape(rect, { x: 3, y: 3 }, 0)).toBe(true);
    expect(hitShape(rect, { x: 6.4, y: 3 }, 0.5)).toBe(true);
    expect(hitShape(rect, { x: 7, y: 3 }, 0.5)).toBe(false);
    const hollowRect: Shape = { ...rect, style: hollow, width: 8, height: 8 };
    expect(hitShape(hollowRect, { x: 6, y: 6 }, 0)).toBe(false);
    expect(hitShape(hollowRect, { x: 2.5, y: 6 }, 0)).toBe(true);
    expect(hitShape(ellipse, { x: 5, y: 5 }, 0)).toBe(true);
    expect(hitShape(ellipse, { x: 2.5, y: 3.5 }, 0)).toBe(false);
    expect(hitShape({ ...ellipse, style: hollow }, { x: 5, y: 5 }, 0)).toBe(false);
    expect(hitShape({ ...ellipse, style: hollow }, { x: 8, y: 5 }, 0)).toBe(true);
    expect(hitShape(line, { x: 5, y: 0.8 }, 0)).toBe(true);
    expect(hitShape(line, { x: 5, y: 2 }, 0)).toBe(false);
    expect(hitShape(triangle, { x: 1, y: 1 }, 0)).toBe(true);
    expect(hitShape(triangle, { x: 7, y: 7 }, 0)).toBe(false);
    expect(hitShape({ ...triangle, closed: false, style: hollow }, { x: 2, y: 2 }, 0)).toBe(false);
    expect(hitShape({ ...triangle, closed: false, style: hollow }, { x: 4, y: 0.5 }, 0)).toBe(true);
  });

  it("tests boxes against a marquee", () => {
    expect(shapeInRect(rect, { x: 0, y: 0, width: 3, height: 3 })).toBe(true);
    expect(shapeInRect(rect, { x: 7, y: 0, width: 3, height: 3 })).toBe(false);
  });

  it("simplifies a pen stroke to the points that matter", () => {
    const straight = Array.from({ length: 20 }, (_, i) => ({ x: i, y: i % 2 === 0 ? 0 : 0.2 }));
    expect(simplifyPoints(straight, 0.5)).toEqual([{ x: 0, y: 0 }, { x: 19, y: 0.2 }]);
    const corner = [{ x: 0, y: 0 }, { x: 5, y: 0.1 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 10 }];
    expect(simplifyPoints(corner, 0.5)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(simplifyPoints([{ x: 1, y: 1 }], 1)).toEqual([{ x: 1, y: 1 }]);
  });
});

describe("pixelsToShapes", () => {
  it("turns runs of one color into rectangles, merged downward when they line up", () => {
    const pixels = new Pixels(4, 3);
    // RR.B / RR.. / ..BB
    pixels.set(0, 0, [255, 0, 0, 255]);
    pixels.set(1, 0, [255, 0, 0, 255]);
    pixels.set(3, 0, [0, 0, 255, 255]);
    pixels.set(0, 1, [255, 0, 0, 255]);
    pixels.set(1, 1, [255, 0, 0, 255]);
    pixels.set(2, 2, [0, 0, 255, 255]);
    pixels.set(3, 2, [0, 0, 255, 255]);
    const shapes = pixelsToShapes(pixels);
    expect(shapes.map(({ id: _id, ...rest }) => rest)).toEqual([
      { kind: "rect", x: 0, y: 0, width: 2, height: 2, style: { fill: "#ff0000", stroke: null, strokeWidth: 1 } },
      { kind: "rect", x: 3, y: 0, width: 1, height: 1, style: { fill: "#0000ff", stroke: null, strokeWidth: 1 } },
      { kind: "rect", x: 2, y: 2, width: 2, height: 1, style: { fill: "#0000ff", stroke: null, strokeWidth: 1 } },
    ]);
    expect(pixelsToShapes(new Pixels(2, 2))).toEqual([]);
  });
});
