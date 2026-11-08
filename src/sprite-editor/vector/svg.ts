import { sheetColumns } from "../sheet";
import { newShapeId, shapeBounds, type Geometry, type Point, type Shape, type ShapeStyle } from "./shapes";
import { parseXml, type XmlElement } from "./xml";

/** A vector sprite as it is written to and read from an SVG file. */
export interface VectorImage {
  width: number;
  height: number;
  /** Shapes in sheet coordinates, back to front. */
  shapes: Shape[];
  /** Paint shapes without smoothing (SVG shape-rendering="crispEdges"), as pixel-art games want. */
  crispEdges: boolean;
}

export interface ParsedSvg extends VectorImage {
  /** What couldn't be read as the editor's shapes, for the user to know. */
  notes: string[];
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Numbers with up to three decimals, and no trailing zeros. */
function num(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/** Fill and stroke attributes; `line` shapes have no inside, so their fill is written as none. */
function styleAttributes(style: ShapeStyle, line: boolean): string {
  const parts = [`fill="${style.fill && !line ? escape(style.fill) : "none"}"`];
  if (style.stroke) {
    parts.push(`stroke="${escape(style.stroke)}"`);
    if (style.strokeWidth !== 1) parts.push(`stroke-width="${num(style.strokeWidth)}"`);
  }
  return parts.join(" ");
}

function shapeElement(shape: Shape): string {
  switch (shape.kind) {
    case "rect":
      return `<rect x="${num(shape.x)}" y="${num(shape.y)}" width="${num(shape.width)}" height="${num(shape.height)}" ${styleAttributes(shape.style, false)} />`;
    case "ellipse":
      return `<ellipse cx="${num(shape.cx)}" cy="${num(shape.cy)}" rx="${num(shape.rx)}" ry="${num(shape.ry)}" ${styleAttributes(shape.style, false)} />`;
    case "line":
      return `<line x1="${num(shape.x1)}" y1="${num(shape.y1)}" x2="${num(shape.x2)}" y2="${num(shape.y2)}" ${styleAttributes(shape.style, true)} />`;
    case "path": {
      const points = shape.points.map((p) => `${num(p.x)},${num(p.y)}`).join(" ");
      const tag = shape.closed ? "polygon" : "polyline";
      const style = styleAttributes(shape.style, !shape.closed);
      return `<${tag} points="${points}" ${style} />`;
    }
  }
}

/**
 * The SVG text for a sprite: one image, or a sheet with every frame in its own nested
 * <svg> cell (which clips it) laid out like the engine's sheets.
 */
export function serializeSvg(
  frames: readonly (readonly Shape[])[],
  frameWidth: number,
  frameHeight: number,
  crispEdges: boolean,
): string {
  const columns = sheetColumns(frameWidth, frames.length);
  const rows = Math.ceil(frames.length / columns);
  const width = columns * frameWidth;
  const height = rows * frameHeight;
  const attributes = [
    `xmlns="${SVG_NS}"`,
    `width="${width}"`,
    `height="${height}"`,
    `viewBox="0 0 ${width} ${height}"`,
    'stroke-linejoin="round"',
    'stroke-linecap="round"',
  ];
  if (crispEdges) attributes.push('shape-rendering="crispEdges"');
  const lines = [`<svg ${attributes.join(" ")}>`];
  if (frames.length === 1) {
    for (const shape of frames[0]) lines.push(`  ${shapeElement(shape)}`);
  } else {
    frames.forEach((shapes, index) => {
      const x = (index % columns) * frameWidth;
      const y = Math.floor(index / columns) * frameHeight;
      lines.push(`  <!-- Frame ${index} -->`);
      lines.push(`  <svg x="${x}" y="${y}" width="${frameWidth}" height="${frameHeight}" viewBox="0 0 ${frameWidth} ${frameHeight}">`);
      for (const shape of shapes) lines.push(`    ${shapeElement(shape)}`);
      lines.push("  </svg>");
    });
  }
  lines.push("</svg>");
  return lines.join("\n") + "\n";
}

// Reading

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  lime: "#00ff00",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  aqua: "#00ffff",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  navy: "#000080",
  teal: "#008080",
  purple: "#800080",
  orange: "#ffa500",
  pink: "#ffc0cb",
  brown: "#a52a2a",
};

/** Paint that couldn't be read (a gradient, an unknown name) shows as this. */
const FALLBACK_COLOR = "#808080";

interface Inherited {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  /** Translation and scale from the ancestors' transforms. */
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

class Reader {
  readonly shapes: Shape[] = [];
  readonly notes = new Map<string, number>();

  note(what: string): void {
    this.notes.set(what, (this.notes.get(what) ?? 0) + 1);
  }

  /** "#rrggbb", null for none, or the fallback (with a note) for paint the editor can't show. */
  color(value: string | undefined, inherited: string | null): string | null {
    if (value === undefined || value === "inherit") return inherited;
    const text = value.trim().toLowerCase();
    if (text === "none" || text === "transparent") return null;
    const hex6 = /^#([0-9a-f]{6})$/.exec(text);
    if (hex6) return `#${hex6[1]}`;
    const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
    if (hex3) return `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`;
    const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(text);
    if (rgb) return "#" + rgb.slice(1, 4).map((c) => Math.min(255, Number(c)).toString(16).padStart(2, "0")).join("");
    if (Object.hasOwn(NAMED_COLORS, text)) return NAMED_COLORS[text];
    this.note(text.startsWith("url(") ? "gradient or pattern fills (shown grey)" : `unknown colors like "${value}" (shown grey)`);
    return FALLBACK_COLOR;
  }

  read(element: XmlElement, parent: Inherited): void {
    const attributes = { ...element.attributes, ...parseStyleAttribute(element.attributes.style) };
    const inherited: Inherited = {
      fill: this.color(attributes.fill, parent.fill),
      stroke: this.color(attributes.stroke, parent.stroke),
      strokeWidth: attributes["stroke-width"] !== undefined ? Number.parseFloat(attributes["stroke-width"]) : parent.strokeWidth,
      tx: parent.tx,
      ty: parent.ty,
      sx: parent.sx,
      sy: parent.sy,
    };
    if (!Number.isFinite(inherited.strokeWidth)) inherited.strokeWidth = parent.strokeWidth;
    this.applyTransform(attributes.transform, inherited);
    if (element.name === "svg") {
      // A nested <svg> places its content at (x, y).
      inherited.tx += length(attributes.x) * inherited.sx;
      inherited.ty += length(attributes.y) * inherited.sy;
    }
    switch (element.name) {
      case "svg":
      case "g":
      case "a":
        for (const child of element.children) this.read(child, inherited);
        return;
      case "defs":
      case "title":
      case "desc":
      case "metadata":
      case "style":
        return;
      case "rect":
        this.add({ kind: "rect", x: length(attributes.x), y: length(attributes.y), width: length(attributes.width), height: length(attributes.height) }, inherited);
        return;
      case "circle": {
        const r = length(attributes.r);
        this.add({ kind: "ellipse", cx: length(attributes.cx), cy: length(attributes.cy), rx: r, ry: r }, inherited);
        return;
      }
      case "ellipse":
        this.add({ kind: "ellipse", cx: length(attributes.cx), cy: length(attributes.cy), rx: length(attributes.rx), ry: length(attributes.ry) }, inherited);
        return;
      case "line":
        this.add({ kind: "line", x1: length(attributes.x1), y1: length(attributes.y1), x2: length(attributes.x2), y2: length(attributes.y2) }, inherited);
        return;
      case "polyline":
      case "polygon":
        this.add({ kind: "path", points: parsePoints(attributes.points ?? ""), closed: element.name === "polygon" }, inherited);
        return;
      case "path":
        for (const subpath of parsePathData(attributes.d ?? "", (what) => this.note(what))) {
          this.add({ kind: "path", points: subpath.points, closed: subpath.closed }, inherited);
        }
        return;
      default:
        this.note(`<${element.name}> elements`);
    }
  }

  private add(geometry: Geometry, inherited: Inherited): void {
    const { tx, ty, sx, sy } = inherited;
    const style: ShapeStyle = {
      fill: inherited.fill,
      stroke: inherited.stroke,
      strokeWidth: inherited.strokeWidth * ((Math.abs(sx) + Math.abs(sy)) / 2),
    };
    const id = newShapeId();
    let shape: Shape;
    switch (geometry.kind) {
      case "rect": {
        const width = geometry.width * sx;
        const height = geometry.height * sy;
        shape = { id, style, kind: "rect", x: tx + geometry.x * sx + Math.min(0, width), y: ty + geometry.y * sy + Math.min(0, height), width: Math.abs(width), height: Math.abs(height) };
        break;
      }
      case "ellipse":
        shape = { id, style, kind: "ellipse", cx: tx + geometry.cx * sx, cy: ty + geometry.cy * sy, rx: Math.abs(geometry.rx * sx), ry: Math.abs(geometry.ry * sy) };
        break;
      case "line":
        shape = { id, style, kind: "line", x1: tx + geometry.x1 * sx, y1: ty + geometry.y1 * sy, x2: tx + geometry.x2 * sx, y2: ty + geometry.y2 * sy };
        break;
      case "path":
        if (geometry.points.length < 2) return;
        shape = { id, style, kind: "path", points: geometry.points.map((p) => ({ x: tx + p.x * sx, y: ty + p.y * sy })), closed: geometry.closed };
        break;
    }
    const box = shapeBounds(shape);
    if (!Number.isFinite(box.x + box.width + box.y + box.height)) {
      this.note("shapes with missing or unreadable sizes");
      return;
    }
    this.shapes.push(shape);
  }

  /** Applies translate and scale; other transforms are noted and skipped. */
  private applyTransform(value: string | undefined, inherited: Inherited): void {
    if (!value) return;
    for (const match of value.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
      const name = match[1];
      const args = match[2].split(/[\s,]+/).filter((part) => part !== "").map(Number);
      if (name === "translate") {
        inherited.tx += (args[0] ?? 0) * inherited.sx;
        inherited.ty += (args[1] ?? 0) * inherited.sy;
      } else if (name === "scale") {
        inherited.sx *= args[0] ?? 1;
        inherited.sy *= args[1] ?? args[0] ?? 1;
      } else {
        this.note(`${name} transforms (ignored)`);
      }
    }
  }
}

/** "fill: red; stroke-width: 2" as attributes. */
function parseStyleAttribute(style: string | undefined): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!style) return attributes;
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    attributes[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
  }
  return attributes;
}

/** A length attribute in user units; px units are allowed, anything else is 0. */
function length(value: string | undefined): number {
  if (value === undefined) return 0;
  const match = /^\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)(px)?\s*$/i.exec(value);
  return match ? Number(match[1]) : NaN;
}

function parsePoints(text: string): Point[] {
  const numbers = text.split(/[\s,]+/).filter((part) => part !== "").map(Number);
  const points: Point[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] });
  return points;
}

/** Path data as straight-line subpaths; curves are flattened, arcs become straight lines. */
export function parsePathData(d: string, note: (what: string) => void): { points: Point[]; closed: boolean }[] {
  const subpaths: { points: Point[]; closed: boolean }[] = [];
  const tokens = d.match(/[MmLlHhVvZzCcSsQqTtAa]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  let current: { points: Point[]; closed: boolean } | null = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // In an object, since closures below set it and TypeScript can't follow that.
  const state: { lastControl: Point | null } = { lastControl: null };
  let command = "";
  let i = 0;
  const next = () => {
    const value = Number(tokens[i++]);
    return Number.isFinite(value) ? value : 0;
  };
  const hasNumber = () => i < tokens.length && /^[-.\d]/.test(tokens[i]);
  const lineTo = (nx: number, ny: number) => {
    if (!current) {
      current = { points: [{ x, y }], closed: false };
      subpaths.push(current);
    }
    x = nx;
    y = ny;
    current.points.push({ x, y });
  };
  const curveTo = (c1: Point, c2: Point, end: Point) => {
    const from = { x, y };
    for (let step = 1; step <= 8; step++) {
      const t = step / 8;
      const u = 1 - t;
      lineTo(
        u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
        u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
      );
    }
    state.lastControl = c2;
  };
  /** The last curve's control point mirrored through the current point (for S and T). */
  const reflected = (): Point => {
    const last = state.lastControl;
    return last ? { x: 2 * x - last.x, y: 2 * y - last.y } : { x, y };
  };
  const quadTo = (c: Point, end: Point) => {
    const from = { x, y };
    curveTo(
      { x: from.x + (2 / 3) * (c.x - from.x), y: from.y + (2 / 3) * (c.y - from.y) },
      { x: end.x + (2 / 3) * (c.x - end.x), y: end.y + (2 / 3) * (c.y - end.y) },
      end,
    );
    state.lastControl = c;
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[A-Za-z]$/.test(token)) {
      command = token;
      i++;
      if (command === "Z" || command === "z") {
        if (current) current.closed = true;
        current = null;
        x = startX;
        y = startY;
        continue;
      }
    } else if (command === "M") {
      command = "L"; // Further pairs after a moveto are linetos.
    } else if (command === "m") {
      command = "l";
    }
    const relative = command === command.toLowerCase();
    const rx = relative ? x : 0;
    const ry = relative ? y : 0;
    switch (command.toUpperCase()) {
      case "M":
        x = rx + next();
        y = ry + next();
        startX = x;
        startY = y;
        current = { points: [{ x, y }], closed: false };
        subpaths.push(current);
        break;
      case "L":
        lineTo(rx + next(), ry + next());
        break;
      case "H":
        lineTo(rx + next(), y);
        break;
      case "V":
        lineTo(x, ry + next());
        break;
      case "C": {
        const c1 = { x: rx + next(), y: ry + next() };
        const c2 = { x: rx + next(), y: ry + next() };
        curveTo(c1, c2, { x: rx + next(), y: ry + next() });
        break;
      }
      case "S": {
        const c1 = reflected();
        const c2 = { x: rx + next(), y: ry + next() };
        curveTo(c1, c2, { x: rx + next(), y: ry + next() });
        break;
      }
      case "Q": {
        const c = { x: rx + next(), y: ry + next() };
        quadTo(c, { x: rx + next(), y: ry + next() });
        break;
      }
      case "T": {
        quadTo(reflected(), { x: rx + next(), y: ry + next() });
        break;
      }
      case "A":
        next();
        next();
        next();
        next();
        next();
        lineTo(rx + next(), ry + next());
        note("arcs in paths (drawn as straight lines)");
        break;
      default:
        i++;
        note("unreadable path data");
    }
    if (!["C", "S", "Q", "T"].includes(command.toUpperCase())) state.lastControl = null;
    if (!hasNumber() && i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) i++;
  }
  return subpaths.filter((subpath) => subpath.points.length >= 2);
}

/** Reads an SVG into shapes in its own coordinates. Throws when it isn't an SVG with a pixel size. */
export function parseSvg(text: string): ParsedSvg {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (error) {
    throw new Error(`Couldn't read the SVG: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (root.name !== "svg") throw new Error("Not an SVG file");
  const width = length(root.attributes.width);
  const height = length(root.attributes.height);
  if (!(width > 0 && height > 0)) {
    throw new Error("The SVG needs width and height attributes in pixels on its root <svg>");
  }
  const reader = new Reader();
  const { x: _x, y: _y, ...rootAttributes } = root.attributes;
  // The root's own x/y don't offset content; viewBox scaling is not applied.
  reader.read({ ...root, attributes: rootAttributes }, { fill: "#000000", stroke: null, strokeWidth: 1, tx: 0, ty: 0, sx: 1, sy: 1 });
  if (root.attributes.viewBox) {
    const box = root.attributes.viewBox.split(/[\s,]+/).map(Number);
    if (box.length === 4 && (box[2] !== width || box[3] !== height)) {
      reader.note("a viewBox that scales the drawing (ignored; shapes keep their own coordinates)");
    }
  }
  const notes = [...reader.notes].map(([what, count]) => (count > 1 ? `${count} × ${what}` : what));
  return {
    width: Math.round(width),
    height: Math.round(height),
    shapes: reader.shapes,
    crispEdges: root.attributes["shape-rendering"] === "crispEdges",
    notes,
  };
}

/** Sorts sheet shapes into frames by where their centers fall in the grid, in frame-local coordinates. */
export function splitShapes(
  shapes: readonly Shape[],
  width: number,
  height: number,
  frameWidth: number,
  frameHeight: number,
): Shape[][] {
  const columns = Math.floor(width / frameWidth);
  const rows = Math.floor(height / frameHeight);
  if (columns === 0 || rows === 0) {
    throw new Error(`The image (${width}x${height}) is smaller than one ${frameWidth}x${frameHeight} frame`);
  }
  const frames: Shape[][] = Array.from({ length: columns * rows }, () => []);
  for (const shape of shapes) {
    const box = shapeBounds(shape);
    const column = Math.min(columns - 1, Math.max(0, Math.floor((box.x + box.width / 2) / frameWidth)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((box.y + box.height / 2) / frameHeight)));
    frames[row * columns + column].push(translate(shape, -column * frameWidth, -row * frameHeight));
  }
  return frames;
}

function translate(shape: Shape, dx: number, dy: number): Shape {
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
