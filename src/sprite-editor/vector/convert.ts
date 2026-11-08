import { toHex } from "../color";
import type { Pixels } from "../pixels";
import { newShapeId, type Shape } from "./shapes";

/**
 * The opaque pixels as filled rectangles (runs of one color, merged with the run above
 * when it lines up), the way hand-made pixel-art SVGs are written. Partly transparent
 * pixels are treated as opaque.
 */
export function pixelsToShapes(pixels: Pixels): Shape[] {
  const shapes: (Shape & { kind: "rect" })[] = [];
  /** The rectangle ending on the previous row at each column start, for merging downward. */
  let above = new Map<number, Shape & { kind: "rect" }>();
  for (let y = 0; y < pixels.height; y++) {
    const row = new Map<number, Shape & { kind: "rect" }>();
    let x = 0;
    while (x < pixels.width) {
      const color = pixels.get(x, y);
      if (color[3] === 0) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < pixels.width) {
        const next = pixels.get(end, y);
        if (next[3] === 0 || next[0] !== color[0] || next[1] !== color[1] || next[2] !== color[2]) break;
        end++;
      }
      const fill = toHex(color);
      const previous = above.get(x);
      if (previous && previous.width === end - x && previous.style.fill === fill) {
        previous.height += 1;
        row.set(x, previous);
      } else {
        const rect: Shape & { kind: "rect" } = {
          id: newShapeId(),
          style: { fill, stroke: null, strokeWidth: 1 },
          kind: "rect",
          x,
          y,
          width: end - x,
          height: 1,
        };
        shapes.push(rect);
        row.set(x, rect);
      }
      x = end;
    }
    above = row;
  }
  return shapes;
}
