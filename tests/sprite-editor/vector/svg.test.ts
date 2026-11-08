import { describe, expect, it } from "vitest";
import backgroundSvg from "../../../projects/demo/images/background.svg?raw";
import heroSvg from "../../../projects/demo/images/hero.svg?raw";
import { shapeBounds, type Shape } from "../../../src/sprite-editor/vector/shapes";
import { parsePathData, parseSvg, serializeSvg, splitShapes } from "../../../src/sprite-editor/vector/svg";
import { parseXml } from "../../../src/sprite-editor/vector/xml";

const style = { fill: "#ff0000", stroke: null, strokeWidth: 1 };

describe("parseXml", () => {
  it("reads elements, attributes and nesting, skipping comments, declarations and text", () => {
    const root = parseXml(`<?xml version="1.0"?>
      <!DOCTYPE svg>
      <svg:svg xmlns:svg="x" width="8" height='4'>
        <!-- a comment with <tags> -->
        <g fill="red"><rect x="1" y="2" width="3" height="4"/>text<circle r="1"></circle></g>
        <![CDATA[ <ignored> ]]>
      </svg:svg>`);
    expect(root.name).toBe("svg");
    expect(root.attributes).toEqual({ "xmlns:svg": "x", width: "8", height: "4" });
    expect(root.children.map((c) => c.name)).toEqual(["g"]);
    expect(root.children[0].children.map((c) => c.name)).toEqual(["rect", "circle"]);
    expect(root.children[0].children[0].attributes).toEqual({ x: "1", y: "2", width: "3", height: "4" });
  });

  it("decodes entities and rejects broken markup", () => {
    expect(parseXml('<a title="&lt;b&gt; &amp; &#65;&#x42;"/>').attributes.title).toBe("<b> & AB");
    expect(() => parseXml("<a><b></a>")).toThrow("Unexpected closing tag");
    expect(() => parseXml("<a>")).toThrow("Unclosed <a>");
    expect(() => parseXml("<a/><b/>")).toThrow("More than one root");
    expect(() => parseXml("just text")).toThrow("No elements");
  });
});

describe("parsePathData", () => {
  const notes: string[] = [];
  const note = (what: string) => notes.push(what);

  it("reads absolute and relative lines, closes subpaths, and starts new ones", () => {
    const paths = parsePathData("M1 2 L3 4 l1 1 H10 v-2 Z M0,0 5,5", note);
    expect(paths).toEqual([
      { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 4, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 3 }], closed: true },
      { points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], closed: false },
    ]);
  });

  it("flattens curves and notes arcs", () => {
    const [curve] = parsePathData("M0 0 C0 10 10 10 10 0", note);
    expect(curve.points.length).toBe(9);
    expect(curve.points[8]).toEqual({ x: 10, y: 0 });
    expect(curve.points[4].y).toBeGreaterThan(5);
    const [arc] = parsePathData("M0 0 A5 5 0 0 1 10 0", note);
    expect(arc.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(notes).toContain("arcs in paths (drawn as straight lines)");
  });
});

describe("parseSvg", () => {
  it("reads shapes with inherited styles and translations into absolute coordinates", () => {
    const parsed = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16" shape-rendering="crispEdges">
      <g fill="#F00" transform="translate(16 0)">
        <rect x="1" y="2" width="3" height="4" />
        <circle cx="8" cy="8" r="2" fill="none" stroke="rgb(0, 0, 255)" stroke-width="2" />
        <g transform="translate(0, 8)"><line x1="0" y1="0" x2="4" y2="0" style="stroke: black; stroke-width: 3" /></g>
      </g>
      <polygon points="0,0 4,0 4,4" fill="#00ff00" />
      <polyline points="0 8, 8 8" stroke="gray" />
      <path d="M0 12 L4 12 L4 16 Z" fill="navy" />
    </svg>`);
    expect([parsed.width, parsed.height, parsed.crispEdges]).toEqual([32, 16, true]);
    expect(parsed.notes).toEqual([]);
    const [rect, circle, line, polygon, polyline, path] = parsed.shapes;
    expect(rect).toMatchObject({ kind: "rect", x: 17, y: 2, width: 3, height: 4, style: { fill: "#ff0000", stroke: null } });
    expect(circle).toMatchObject({ kind: "ellipse", cx: 24, cy: 8, rx: 2, ry: 2, style: { fill: null, stroke: "#0000ff", strokeWidth: 2 } });
    expect(line).toMatchObject({ kind: "line", x1: 16, y1: 8, x2: 20, y2: 8, style: { stroke: "#000000", strokeWidth: 3 } });
    expect(polygon).toMatchObject({ kind: "path", closed: true, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], style: { fill: "#00ff00" } });
    expect(polyline).toMatchObject({ kind: "path", closed: false, style: { fill: "#000000", stroke: "#808080" } });
    expect(path).toMatchObject({ kind: "path", closed: true, style: { fill: "#000080" } });
    expect(new Set(parsed.shapes.map((s) => s.id)).size).toBe(6);
  });

  it("notes what it can't read and keeps going", () => {
    const parsed = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
      <defs><linearGradient id="g"/></defs>
      <rect width="10" height="10" fill="url(#g)" />
      <text x="1" y="1">hi</text>
      <g transform="rotate(45)"><rect width="2" height="2" fill="#123456"/></g>
      <ellipse cx="1" cy="1" rx="abc" ry="1" />
    </svg>`);
    expect(parsed.shapes).toHaveLength(2);
    expect(parsed.shapes[0].style.fill).toBe("#808080");
    expect(parsed.notes).toEqual([
      "gradient or pattern fills (shown grey)",
      "<text> elements",
      "rotate transforms (ignored)",
      "shapes with missing or unreadable sizes",
    ]);
  });

  it("rejects files that aren't SVGs with a pixel size", () => {
    expect(() => parseSvg("<html/>")).toThrow("Not an SVG");
    expect(() => parseSvg("<svg/>")).toThrow("width and height");
    expect(() => parseSvg('<svg width="100%" height="10"/>')).toThrow("width and height");
    expect(() => parseSvg("<svg")).toThrow("Couldn't read the SVG");
  });

  it("reads the demo game's SVG image files", () => {
    const hero = parseSvg(heroSvg);
    expect([hero.width, hero.height, hero.crispEdges]).toEqual([96, 16, true]);
    expect(hero.notes).toEqual([]);
    expect(hero.shapes.every((s) => s.kind === "rect")).toBe(true);
    const frames = splitShapes(hero.shapes, 96, 16, 16, 16);
    expect(frames).toHaveLength(6);
    expect(frames.flat()).toHaveLength(32);
    expect(frames.every((f) => f.length >= 5)).toBe(true);
    // Frame 1 is drawn at x 16..32 in the file; in the frame it starts at 0.
    expect(shapeBounds(frames[1][0]).x).toBe(5);
    const background = parseSvg(backgroundSvg);
    expect([background.width, background.height]).toEqual([800, 600]);
    expect(background.shapes.map((s) => s.kind)).toEqual(["rect", ...Array<string>(8).fill("ellipse"), "ellipse", "path", "rect"]);
    expect(background.notes).toEqual(["gradient or pattern fills (shown grey)"]);
  });
});

describe("serializeSvg", () => {
  const shapes: Shape[] = [
    { id: 1, style, kind: "rect", x: 1, y: 2, width: 3, height: 4 },
    { id: 2, style: { fill: null, stroke: "#0000ff", strokeWidth: 2 }, kind: "ellipse", cx: 4, cy: 4, rx: 2, ry: 1.5 },
    { id: 3, style: { fill: "#ff0000", stroke: "#000000", strokeWidth: 1 }, kind: "line", x1: 0, y1: 0, x2: 3, y2: 3.333333 },
    { id: 4, style, kind: "path", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], closed: true },
    { id: 5, style: { fill: null, stroke: "#00ff00", strokeWidth: 1 }, kind: "path", points: [{ x: 0, y: 5 }, { x: 5, y: 5 }], closed: false },
  ];

  it("writes a single image the engine can load, and reads it back the same", () => {
    const text = serializeSvg([shapes], 8, 8, true);
    expect(text).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"');
    expect(text).toContain('shape-rendering="crispEdges"');
    expect(text).toContain('<rect x="1" y="2" width="3" height="4" fill="#ff0000" />');
    expect(text).toContain('<ellipse cx="4" cy="4" rx="2" ry="1.5" fill="none" stroke="#0000ff" stroke-width="2" />');
    expect(text).toContain('<line x1="0" y1="0" x2="3" y2="3.333" fill="none" stroke="#000000" />');
    expect(text).toContain('<polygon points="0,0 2,0 2,2" fill="#ff0000" />');
    expect(text).toContain('<polyline points="0,5 5,5" fill="none" stroke="#00ff00" />');
    const back = parseSvg(text);
    expect(back.notes).toEqual([]);
    expect(back.crispEdges).toBe(true);
    expect(back.shapes.map(({ id: _id, ...rest }) => rest)).toEqual(
      shapes.map(({ id: _id, ...rest }) => (rest.kind === "line" ? { ...rest, y2: 3.333, style: { ...rest.style, fill: null } } : rest)),
    );
  });

  it("writes a sheet with each frame in its own cell, and splits it back into frames", () => {
    const frame0 = [shapes[0]];
    const frame1 = [shapes[1]];
    const frame2 = [shapes[3]];
    const text = serializeSvg([frame0, frame1, frame2], 8, 8, false);
    expect(text).toContain('width="24" height="8"');
    expect(text).toContain('<svg x="16" y="0" width="8" height="8" viewBox="0 0 8 8">');
    expect(text).not.toContain("crispEdges");
    const back = parseSvg(text);
    const frames = splitShapes(back.shapes, back.width, back.height, 8, 8);
    expect(frames.map((f) => f.length)).toEqual([1, 1, 1]);
    expect(frames[1][0]).toMatchObject({ kind: "ellipse", cx: 4, cy: 4 });
    expect(frames[2][0]).toMatchObject({ kind: "path", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }] });
  });

  it("sorts shapes into frames by their centers, and refuses frames bigger than the image", () => {
    const wide: Shape = { id: 9, style, kind: "rect", x: 6, y: 0, width: 4, height: 2 }; // center at x 8: frame 1
    expect(splitShapes([wide], 16, 8, 8, 8)[1]).toEqual([{ ...wide, x: -2 }]);
    expect(() => splitShapes([], 4, 4, 8, 8)).toThrow("smaller than one 8x8 frame");
  });
});
