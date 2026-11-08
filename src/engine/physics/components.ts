import { DEFAULT_LAYER } from "./layers";
import type { ColliderShape } from "./shapes";

/**
 * Movement in pixels per second. On its own it moves the Transform and nothing
 * else touches it (kinematic). With a Body, gravity and forces change it too.
 */
export class Velocity {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

export interface BodyOptions {
  /** Mass, in arbitrary units; must be positive. Defaults to 1. */
  mass?: number;
  /** How much of the world's gravity applies: 0 floats, -1 falls up. Defaults to 1. */
  gravityScale?: number;
  /** Fraction of velocity lost per second (0 to 1), like air drag. Defaults to 0. */
  damping?: number;
}

/**
 * Makes an entity's Velocity respond to gravity and forces. Needs a Velocity;
 * with a Transform the entity moves as well, and with a Collider it gets pushed
 * around by what it hits.
 *
 * Forces and impulses add up over a step and are used (and cleared) when the
 * physics system runs, so it does not matter how many systems apply them.
 */
export class Body {
  mass: number;
  gravityScale: number;
  damping: number;
  /** Force to apply this step, in mass units * px/s². Cleared by the physics system. */
  forceX = 0;
  forceY = 0;
  /** Impulse to apply this step, in mass units * px/s. Cleared by the physics system. */
  impulseX = 0;
  impulseY = 0;

  constructor(options: BodyOptions = {}) {
    this.mass = options.mass ?? 1;
    this.gravityScale = options.gravityScale ?? 1;
    this.damping = options.damping ?? 0;
  }

  /** Pushes the body over time: a constant force is a constant acceleration of force / mass. */
  applyForce(x: number, y: number): void {
    this.forceX += x;
    this.forceY += y;
  }

  /** Kicks the body: an impulse changes its velocity by impulse / mass at once. Good for jumps. */
  applyImpulse(x: number, y: number): void {
    this.impulseX += x;
    this.impulseY += y;
  }
}

export interface ColliderOptions {
  /** What fills the box: the box itself, a circle, or a capsule. Defaults to "box". */
  shape?: ColliderShape;
  /**
   * Which collision layer the box is on; the game's `collisionLayers` say which layers are
   * solid against each other, which only touch, and which ignore each other. Defaults to
   * "default", which is solid against everything the rules do not pair it with.
   */
  layer?: string;
  /** Where the box's top-left corner is, relative to the Transform. Defaults to 0, 0. */
  offsetX?: number;
  offsetY?: number;
  /**
   * Bounciness: the fraction of speed kept after a hit, 0 (none) to 1 (all of it).
   * A collision uses the higher of the two colliders' values. Defaults to 0.
   */
  restitution?: number;
  /**
   * Resistance to sliding along another collider: 0 is ice, 1 is very rough. A collision
   * combines both colliders' values (the square root of their product). Defaults to 0.2.
   */
  friction?: number;
}

/**
 * A solid shape: a box, or the circle or capsule that fits in one. Colliders never
 * overlap: the physics system pushes them apart and the hit changes their velocities,
 * like a bounce or a shove. Every touch is listed in the Contacts resource for the
 * rest of the step. Who gives way:
 *
 * - A Collider on its own never moves (walls, floors).
 * - With a Velocity but no Body it moves and pushes bodies, but nothing pushes it
 *   back (moving platforms); it passes through other non-bodies.
 * - With a Body and a Velocity it is pushed by mass: a heavy body shoves a light one.
 *
 * Moving faster than its own (or the other box's) thickness in one step can skip
 * through it, so keep walls thicker than anything's speed / 60.
 */
export class Collider {
  shape: ColliderShape;
  layer: string;
  offsetX: number;
  offsetY: number;
  restitution: number;
  friction: number;

  constructor(
    public width = 32,
    public height = 32,
    options: ColliderOptions = {},
  ) {
    this.shape = options.shape ?? "box";
    this.layer = options.layer ?? DEFAULT_LAYER;
    this.offsetX = options.offsetX ?? 0;
    this.offsetY = options.offsetY ?? 0;
    this.restitution = options.restitution ?? 0;
    this.friction = options.friction ?? 0.2;
  }
}
