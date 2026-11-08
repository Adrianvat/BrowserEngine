import type { Entity, World } from "../ecs/world";
import { Transform } from "../render/components";
import { colliderBox, type ColliderBox } from "./collisions";
import { Collider } from "./components";
import { roundOf, type Round } from "./shapes";

/** Where a ray first met a collider. */
export interface RaycastHit {
  entity: Entity;
  /** The point hit, in scene pixels. */
  x: number;
  y: number;
  /** How far from the ray's start the point is, in pixels. */
  distance: number;
  /** The surface's outward unit normal at the point: (0, -1) is the top of a floor. */
  nx: number;
  ny: number;
}

export interface RaycastOptions {
  /** How far the ray reaches, in pixels. Defaults to Infinity. */
  maxDistance?: number;
  /** Only colliders on these layers are hit. Defaults to every layer. */
  layers?: readonly string[];
  /** Colliders on these entities are passed through, e.g. the one casting. */
  ignore?: readonly Entity[];
}

/**
 * The first collider a ray from (x, y) heading along (dx, dy) runs into, or null. For
 * line of sight, shots, or checking for ground below a foot. Colliders the ray starts
 * inside are passed through, so a ray from an entity's own center does not hit itself.
 * Reads colliders where they are now: cast after the physics system for this step's
 * positions.
 */
export function raycast(
  world: World,
  x: number,
  y: number,
  dx: number,
  dy: number,
  options: RaycastOptions = {},
): RaycastHit | null {
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) throw new Error(`Raycast direction must not be zero, got ${dx}, ${dy}`);
  const ray: Ray = { x, y, dx: dx / length, dy: dy / length };
  const { maxDistance = Infinity, layers, ignore } = options;
  let best: RaycastHit | null = null;
  for (const [entity, transform, collider] of world.query(Transform, Collider)) {
    if (layers && !layers.includes(collider.layer)) continue;
    if (ignore?.includes(entity)) continue;
    const box = colliderBox(transform, collider);
    const hit = collider.shape === "box" ? rayBox(ray, box) : rayRound(ray, roundOf(box, collider.shape));
    if (!hit || hit.t > maxDistance || (best && hit.t >= best.distance)) continue;
    best = {
      entity,
      x: x + ray.dx * hit.t,
      y: y + ray.dy * hit.t,
      distance: hit.t,
      nx: hit.nx,
      ny: hit.ny,
    };
  }
  return best;
}

/** A ray with a unit-length direction. */
interface Ray {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/** How far along a ray it enters a shape, and the shape's normal there. */
interface Entry {
  t: number;
  nx: number;
  ny: number;
}

/** Where a ray enters a box (slab test), or null if it misses or starts inside. */
function rayBox(ray: Ray, box: ColliderBox): Entry | null {
  let enter = -Infinity;
  let exit = Infinity;
  let nx = 0;
  let ny = 0;
  for (const [origin, direction, low, high, axisX] of [
    [ray.x, ray.dx, box.x, box.x + box.width, true],
    [ray.y, ray.dy, box.y, box.y + box.height, false],
  ] as const) {
    if (direction === 0) {
      if (origin < low || origin > high) return null; // Parallel to this slab and outside it.
      continue;
    }
    const near = ((direction > 0 ? low : high) - origin) / direction;
    const far = ((direction > 0 ? high : low) - origin) / direction;
    if (near > enter) {
      enter = near;
      // The ray comes in through the face it heads towards, which faces back at it.
      nx = axisX ? -Math.sign(direction) : 0;
      ny = axisX ? 0 : -Math.sign(direction);
    }
    exit = Math.min(exit, far);
  }
  if (enter > exit || enter < 0) return null; // Missed, or behind / around the start.
  return { t: enter, nx, ny };
}

/** Where a ray enters a circle or capsule, or null if it misses or starts inside. */
function rayRound(ray: Ray, round: Round): Entry | null {
  if (distanceToSegment(ray.x, ray.y, round) < round.r) return null;
  // A capsule is its two end circles plus the box between their centers, as thick as
  // they are; the ray enters it where it enters the first of those.
  let best = rayCircle(ray, round.x1, round.y1, round.r);
  const second = rayCircle(ray, round.x2, round.y2, round.r);
  if (second && (!best || second.t < best.t)) best = second;
  if (round.x1 !== round.x2 || round.y1 !== round.y2) {
    const core = rayBox(ray, {
      x: Math.min(round.x1, round.x2) - (round.y1 === round.y2 ? 0 : round.r),
      y: Math.min(round.y1, round.y2) - (round.x1 === round.x2 ? 0 : round.r),
      width: Math.abs(round.x2 - round.x1) + (round.y1 === round.y2 ? 0 : 2 * round.r),
      height: Math.abs(round.y2 - round.y1) + (round.x1 === round.x2 ? 0 : 2 * round.r),
    });
    if (core && (!best || core.t < best.t)) best = core;
  }
  return best;
}

/** Where a ray from outside a circle enters it, or null if it misses. */
function rayCircle(ray: Ray, cx: number, cy: number, r: number): Entry | null {
  const ox = ray.x - cx;
  const oy = ray.y - cy;
  const along = ox * ray.dx + oy * ray.dy;
  const discriminant = along * along - (ox * ox + oy * oy - r * r);
  if (discriminant < 0) return null;
  const t = -along - Math.sqrt(discriminant);
  if (t < 0) return null;
  return { t, nx: (ox + ray.dx * t) / r, ny: (oy + ray.dy * t) / r };
}

function distanceToSegment(px: number, py: number, { x1, y1, x2, y2 }: Round): number {
  const sx = x2 - x1;
  const sy = y2 - y1;
  const lengthSquared = sx * sx + sy * sy;
  const s =
    lengthSquared === 0 ? 0 : Math.min(Math.max(((px - x1) * sx + (py - y1) * sy) / lengthSquared, 0), 1);
  return Math.hypot(px - (x1 + sx * s), py - (y1 + sy * s));
}
