import type { Entity, World } from "../ecs/world";
import { Transform } from "../render/components";
import { Body, Collider, Velocity } from "./components";
import { Contacts } from "./contacts";
import { Gravity } from "./gravity";
import { CollisionLayers } from "./layers";
import { boxRound, roundOf, roundRound, type Hit } from "./shapes";

/** A collider's box in scene pixels. */
export interface ColliderBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a collider sits: its Transform plus its offset. */
export function colliderBox(transform: Transform, collider: Collider): ColliderBox {
  return {
    x: transform.x + collider.offsetX,
    y: transform.y + collider.offsetY,
    width: collider.width,
    height: collider.height,
  };
}

/**
 * How many rounds of pushing apart one step gets. Separating one pair can push a
 * box into another (a stack, a corner), so the rounds repeat until nothing overlaps.
 */
export const ITERATIONS = 8;

/** Overlaps this small are float leftovers of an earlier separation, not hits. */
const EPSILON = 1e-6;

/** Slack, in pixels, when judging whether a step's motion could have caused an overlap. */
const SLOP = 0.01;

/** Cosine of the widest angle from gravity at which one shape still rests on another. */
const STACKED = Math.SQRT1_2;

/** Everything about one collider the resolver needs, gathered once per step. */
interface Solid {
  entity: Entity;
  transform: Transform;
  collider: Collider;
  velocity: Velocity | null;
  /** 1 / mass, or 0 for anything without a Body and Velocity: it cannot be pushed. */
  invMass: number;
  /** The box's left edge, refreshed at the start of each round for the sweep. */
  left: number;
  /** How far along gravity the box's center is, refreshed for a shock round. */
  depth: number;
}

/** Two solids that may meet this step, and whether they are pushed apart when they do. */
interface Pair {
  a: Solid;
  b: Solid;
  /** False for a touch-only pair, and for one where neither side can be pushed. */
  solid: boolean;
}

/** An overlap between two solids: the unit normal points from `a` to `b`. */
interface Overlap {
  a: Solid;
  b: Solid;
  nx: number;
  ny: number;
  depth: number;
  /** The inverse masses to resolve with; a shock round holds the supporting side still. */
  invA: number;
  invB: number;
}

const STILL = new Velocity(0, 0);

/**
 * Lists every touch of the step in the Contacts resource, pushes overlapping solid
 * colliders apart and applies the collision's impulses to their velocities (a bounce
 * by restitution, a slowdown by friction). Runs after the entities have moved, as the
 * last part of the physics system.
 */
export function resolveCollisions(world: World, dt: number): void {
  const contacts = world.getResource(Contacts);
  contacts.clear();
  const solids = collectSolids(world);
  if (solids.length < 2 || !solids.some((solid) => solid.velocity)) return;
  const gravity = world.getResource(Gravity);
  const layers = world.getResource(CollisionLayers);
  // A resting body falls into its support by gravity * dt every step and is pushed back
  // out. Hits slower than that (with some margin) do not bounce, so things settle.
  const restingSpeed = 2 * Math.hypot(gravity.x, gravity.y) * dt;

  // Pushing a box out of one overlap can push it into a neighbour it only touched, so the
  // candidates are found once with some reach: nothing gets pushed further this step than
  // the fastest box travelled (twice that, squeezed from both sides).
  let travel = 0;
  for (const { velocity } of solids) {
    if (velocity) travel = Math.max(travel, Math.hypot(velocity.x, velocity.y) * dt);
  }
  const pairs = candidatePairs(solids, 2 * travel + SLOP, layers);

  let separated = true;
  for (let round = 0; round < ITERATIONS && separated; round++) {
    separated = resolveRound(pairs, dt, restingSpeed, null, contacts);
  }
  // A tall pile converges slowly round by round, the error creeping up from the bottom.
  // One last round over the stacked pairs only, from the bottom up with each box's
  // support held still, settles it.
  if (separated && (gravity.x !== 0 || gravity.y !== 0)) {
    resolveRound(stackedPairs(solids, pairs, gravity), dt, restingSpeed, gravity, contacts);
  }
}

function collectSolids(world: World): Solid[] {
  return world.query(Transform, Collider).map(([entity, transform, collider]) => {
    checkCollider(collider);
    const velocity = world.get(entity, Velocity) ?? null;
    const body = world.get(entity, Body);
    return {
      entity,
      transform,
      collider,
      velocity,
      invMass: body && velocity ? 1 / body.mass : 0,
      left: 0,
      depth: 0,
    };
  });
}

/**
 * Bad values (e.g. typed in the editor) would make a collider silently hollow, or make
 * every bounce add energy until things fly off.
 */
function checkCollider(collider: Collider): void {
  const { width, height, restitution, friction } = collider;
  if (!(width > 0 && height > 0)) {
    throw new Error(`Collider size must be positive, got ${String(width)}x${String(height)}`);
  }
  if (!(restitution >= 0 && restitution <= 1)) {
    throw new Error(`Collider restitution must be between 0 and 1, got ${String(restitution)}`);
  }
  if (!(friction >= 0)) {
    throw new Error(`Collider friction must not be negative, got ${String(friction)}`);
  }
}

/**
 * Records every overlapping pair as a touch and separates the solid ones once, in the
 * order given. Returns whether any pair was separated. In a shock round (`support`
 * given) each pair's first box is the lower one and is held still, so the upper one is
 * pushed fully out of it; only resting hits change velocities then, since holding a
 * moving box still would pump energy into a fast one.
 */
function resolveRound(
  pairs: Pair[],
  dt: number,
  restingSpeed: number,
  support: Gravity | null,
  contacts: Contacts,
): boolean {
  let separated = false;
  for (const { a, b, solid } of pairs) {
    const overlap = findOverlap(a, b, dt, support);
    if (!overlap) continue;
    contacts.add(a.entity, b.entity, overlap.nx, overlap.ny);
    if (!solid) continue;
    separated = true;
    separate(overlap);
    applyImpulses(overlap, restingSpeed, support !== null);
  }
  return separated;
}

/**
 * Pairs whose boxes overlap or come within `reach` of each other on the x axis, where
 * at least one of them moves and their layers interact. Sorting by left edge lets the
 * scan stop early instead of testing every pair.
 */
function candidatePairs(solids: Solid[], reach: number, layers: CollisionLayers): Pair[] {
  for (const solid of solids) solid.left = solid.transform.x + solid.collider.offsetX;
  solids.sort((a, b) => a.left - b.left || a.entity - b.entity);
  const pairs: Pair[] = [];
  for (let i = 0; i < solids.length; i++) {
    const a = solids[i];
    const right = a.left + a.collider.width + reach;
    for (let j = i + 1; j < solids.length && solids[j].left < right; j++) {
      const b = solids[j];
      if (!a.velocity && !b.velocity) continue; // Neither moves: nothing new can happen.
      const interaction = layers.interaction(a.collider.layer, b.collider.layer);
      if (interaction === "none") continue;
      const solid = interaction === "solid" && a.invMass + b.invMass > 0;
      pairs.push({ a, b, solid });
    }
  }
  return pairs;
}

/** The solid pairs with the lower box (along `support`) first, ordered from the lowest pair up. */
function stackedPairs(solids: Solid[], pairs: Pair[], support: Gravity): Pair[] {
  for (const solid of solids) {
    const { collider, transform } = solid;
    const centerX = transform.x + collider.offsetX + collider.width / 2;
    const centerY = transform.y + collider.offsetY + collider.height / 2;
    solid.depth = centerX * support.x + centerY * support.y;
  }
  return pairs
    .filter((pair) => pair.solid)
    .map(({ a, b }): Pair => (a.depth >= b.depth ? { a, b, solid: true } : { a: b, b: a, solid: true }))
    .sort((p, q) => q.a.depth - p.a.depth);
}

/**
 * The overlap of two solids as they are right now, or null if they only touch or are
 * apart. In a shock round (`support` given) only pairs stacked along gravity count,
 * `a` is the lower box, and it is held still when both could move.
 */
function findOverlap(a: Solid, b: Solid, dt: number, support: Gravity | null): Overlap | null {
  const hit = hitOf(a, b, dt);
  if (!hit) return null;
  const { nx, ny, depth } = hit;
  if (support === null) return { a, b, nx, ny, depth, invA: a.invMass, invB: b.invMass };
  // Stacked means the push is within 45 degrees of gravity; side by side does not count.
  const along = Math.abs(nx * support.x + ny * support.y);
  if (along < STACKED * Math.hypot(support.x, support.y)) return null;
  return { a, b, nx, ny, depth, invA: b.invMass > 0 ? 0 : a.invMass, invB: b.invMass };
}

/** The overlap of two solids' shapes, whatever they are; the normal points from `a` to `b`. */
function hitOf(a: Solid, b: Solid, dt: number): Hit | null {
  const shapeA = a.collider.shape;
  const shapeB = b.collider.shape;
  if (shapeA === "box" && shapeB === "box") return boxBox(a, b, dt);
  const boxA = colliderBox(a.transform, a.collider);
  const boxB = colliderBox(b.transform, b.collider);
  if (shapeA !== "box" && shapeB !== "box") {
    return roundRound(roundOf(boxA, shapeA), roundOf(boxB, shapeB));
  }
  if (shapeA === "box") return boxRound(boxA, roundOf(boxB, shapeB as "circle" | "capsule"));
  const hit = boxRound(boxB, roundOf(boxA, shapeA));
  return hit && { nx: -hit.nx, ny: -hit.ny, depth: hit.depth };
}

/** Two boxes: pushed apart along one axis, the one they met along. */
function boxBox(a: Solid, b: Solid, dt: number): Hit | null {
  const ax = a.transform.x + a.collider.offsetX;
  const ay = a.transform.y + a.collider.offsetY;
  const bx = b.transform.x + b.collider.offsetX;
  const by = b.transform.y + b.collider.offsetY;
  // How far a's right edge is past b's left edge, and b's right past a's left.
  const overlapRight = ax + a.collider.width - bx;
  const overlapLeft = bx + b.collider.width - ax;
  if (overlapRight <= EPSILON || overlapLeft <= EPSILON) return null;
  const overlapBottom = ay + a.collider.height - by;
  const overlapTop = by + b.collider.height - ay;
  if (overlapBottom <= EPSILON || overlapTop <= EPSILON) return null;

  const depthX = Math.min(overlapRight, overlapLeft);
  const depthY = Math.min(overlapBottom, overlapTop);
  if (alongX(a, b, depthX, depthY, dt)) {
    return { nx: overlapRight < overlapLeft ? 1 : -1, ny: 0, depth: depthX };
  }
  return { nx: 0, ny: overlapBottom < overlapTop ? 1 : -1, depth: depthY };
}

/**
 * Whether the two met along the x axis. The axis they crossed during this step's motion
 * (the overlap is no deeper than the step's relative travel) is the one they hit along,
 * and when both are, the one crossed more recently; this is not always the shallower
 * one, e.g. a small fast box landing deep into a floor. An overlap that motion cannot
 * explain was made by a push from a third box, and then the shallower overlap decides,
 * ties going to y so a box on a corner lands on top rather than slipping off.
 */
function alongX(a: Solid, b: Solid, depthX: number, depthY: number, dt: number): boolean {
  const va = a.velocity ?? STILL;
  const vb = b.velocity ?? STILL;
  const speedX = Math.abs(vb.x - va.x);
  const speedY = Math.abs(vb.y - va.y);
  const crossedX = depthX <= speedX * dt + SLOP;
  const crossedY = depthY <= speedY * dt + SLOP;
  if (crossedX && crossedY) return depthX / speedX < depthY / speedY;
  if (crossedX || crossedY) return crossedX;
  return depthX < depthY;
}

/** Moves the two apart so they touch, the lighter one moving more. */
function separate({ a, b, nx, ny, depth, invA, invB }: Overlap): void {
  const invTotal = invA + invB;
  const moveA = (depth * invA) / invTotal;
  const moveB = (depth * invB) / invTotal;
  a.transform.x -= nx * moveA;
  a.transform.y -= ny * moveA;
  b.transform.x += nx * moveB;
  b.transform.y += ny * moveB;
}

/**
 * Stops the two approaching (or bounces them), then slows their sliding by friction.
 * `restingOnly` limits this to slow, resting contacts: a shock round holds one side
 * still, which would pump energy into a fast hit.
 */
function applyImpulses(
  { a, b, nx, ny, invA, invB }: Overlap,
  restingSpeed: number,
  restingOnly: boolean,
): void {
  const va = a.velocity ?? STILL;
  const vb = b.velocity ?? STILL;
  const approach = -((vb.x - va.x) * nx + (vb.y - va.y) * ny);
  if (approach <= 0) return; // Already moving apart.
  const resting = approach <= restingSpeed;
  if (restingOnly && !resting) return;
  const invTotal = invA + invB;

  const restitution = resting ? 0 : Math.max(a.collider.restitution, b.collider.restitution);
  const normalImpulse = ((1 + restitution) * approach) / invTotal;
  push(a, invA, -normalImpulse * nx, -normalImpulse * ny);
  push(b, invB, normalImpulse * nx, normalImpulse * ny);

  // Sliding speed along the surface: the relative velocity along the tangent, the
  // normal turned a quarter turn.
  const slide = (vb.x - va.x) * -ny + (vb.y - va.y) * nx;
  if (slide === 0) return;
  const friction = Math.sqrt(a.collider.friction * b.collider.friction);
  // Coulomb: friction can take away up to `friction` times the normal impulse, never more
  // than would stop the sliding outright.
  const frictionImpulse = Math.min(Math.abs(slide) / invTotal, friction * normalImpulse);
  const tx = -ny * Math.sign(slide);
  const ty = nx * Math.sign(slide);
  push(a, invA, frictionImpulse * tx, frictionImpulse * ty);
  push(b, invB, -frictionImpulse * tx, -frictionImpulse * ty);
}

function push(solid: Solid, invMass: number, impulseX: number, impulseY: number): void {
  if (invMass === 0 || !solid.velocity) return;
  solid.velocity.x += impulseX * invMass;
  solid.velocity.y += impulseY * invMass;
}
