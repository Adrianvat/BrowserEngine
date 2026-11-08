import type { ColliderBox } from "./collisions";

/**
 * What a collider's box holds: the box itself, the circle that fits in it (its
 * shorter side is the diameter), or a capsule along its longer side with round
 * ends (a box with equal sides is a circle).
 */
export type ColliderShape = "box" | "circle" | "capsule";

/** Every name in ColliderShape, as the editor lists them. */
export const COLLIDER_SHAPES: readonly ColliderShape[] = ["box", "circle", "capsule"];

/**
 * A circle or capsule as a line segment with a radius around it: every point within
 * `r` of the segment is inside. A circle's segment is a single point.
 */
export interface Round {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  r: number;
}

/** How two shapes overlap: how deep, and which way to push the second one (unit length). */
export interface Hit {
  nx: number;
  ny: number;
  depth: number;
}

/** Overlaps this small are float leftovers of an earlier separation, not hits. */
const EPSILON = 1e-6;

/** The circle or capsule that fits in a collider's box. */
export function roundOf(box: ColliderBox, shape: "circle" | "capsule"): Round {
  const r = Math.min(box.width, box.height) / 2;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (shape === "circle") return { x1: cx, y1: cy, x2: cx, y2: cy, r };
  // A capsule runs along the longer side; its ends are the centers of the round caps.
  return box.width >= box.height
    ? { x1: box.x + r, y1: cy, x2: box.x + box.width - r, y2: cy, r }
    : { x1: cx, y1: box.y + r, x2: cx, y2: box.y + box.height - r, r };
}

/** The overlap of two round shapes, or null if they only touch or are apart. */
export function roundRound(a: Round, b: Round): Hit | null {
  const [ax, ay, bx, by] = closestPoints(a, b);
  const dx = bx - ax;
  const dy = by - ay;
  const distance = Math.hypot(dx, dy);
  const depth = a.r + b.r - distance;
  if (depth <= EPSILON) return null;
  // Segments crossing (or concentric circles) give no direction; push b down.
  if (distance <= EPSILON) return { nx: 0, ny: 1, depth };
  return { nx: dx / distance, ny: dy / distance, depth };
}

/** The overlap of a box and a round shape, or null if they only touch or are apart. */
export function boxRound(box: ColliderBox, round: Round): Hit | null {
  // The shapes are axis-aligned, so the segment's point nearest the box's center is
  // also its point nearest the box. From there on it is a circle against the box.
  const cx = clamp(box.x + box.width / 2, Math.min(round.x1, round.x2), Math.max(round.x1, round.x2));
  const cy = clamp(box.y + box.height / 2, Math.min(round.y1, round.y2), Math.max(round.y1, round.y2));
  const qx = clamp(cx, box.x, box.x + box.width);
  const qy = clamp(cy, box.y, box.y + box.height);
  const dx = cx - qx;
  const dy = cy - qy;
  const distance = Math.hypot(dx, dy);
  if (distance > EPSILON) {
    const depth = round.r - distance;
    if (depth <= EPSILON) return null;
    return { nx: dx / distance, ny: dy / distance, depth };
  }
  // The segment is inside the box: out through the nearest face. How far depends on the
  // whole shape, not just its point nearest the center (a long capsule has far to go
  // along its length).
  const toLeft = Math.max(round.x1, round.x2) + round.r - box.x;
  const toRight = box.x + box.width - (Math.min(round.x1, round.x2) - round.r);
  const toTop = Math.max(round.y1, round.y2) + round.r - box.y;
  const toBottom = box.y + box.height - (Math.min(round.y1, round.y2) - round.r);
  const depth = Math.min(toLeft, toRight, toTop, toBottom);
  if (depth === toLeft) return { nx: -1, ny: 0, depth };
  if (depth === toRight) return { nx: 1, ny: 0, depth };
  if (depth === toTop) return { nx: 0, ny: -1, depth };
  return { nx: 0, ny: 1, depth };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** The closest pair of points on two segments, one on each: [ax, ay, bx, by]. */
function closestPoints(a: Round, b: Round): [number, number, number, number] {
  // Ericson, Real-Time Collision Detection, 5.1.9.
  const d1x = a.x2 - a.x1;
  const d1y = a.y2 - a.y1;
  const d2x = b.x2 - b.x1;
  const d2y = b.y2 - b.y1;
  const rx = a.x1 - b.x1;
  const ry = a.y1 - b.y1;
  const lengthA = d1x * d1x + d1y * d1y;
  const lengthB = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  let s = 0;
  let t = 0;
  if (lengthA > EPSILON || lengthB > EPSILON) {
    if (lengthA <= EPSILON) {
      t = clamp(f / lengthB, 0, 1);
    } else {
      const c = d1x * rx + d1y * ry;
      if (lengthB <= EPSILON) {
        s = clamp(-c / lengthA, 0, 1);
      } else {
        const dot = d1x * d2x + d1y * d2y;
        const denominator = lengthA * lengthB - dot * dot;
        // Parallel segments have no single answer; any point of a will do.
        s = denominator !== 0 ? clamp((dot * f - c * lengthB) / denominator, 0, 1) : 0;
        t = (dot * s + f) / lengthB;
        if (t < 0) {
          t = 0;
          s = clamp(-c / lengthA, 0, 1);
        } else if (t > 1) {
          t = 1;
          s = clamp((dot - c) / lengthA, 0, 1);
        }
      }
    }
  }
  return [a.x1 + d1x * s, a.y1 + d1y * s, b.x1 + d2x * t, b.y1 + d2y * t];
}
