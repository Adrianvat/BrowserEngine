import type { World } from "../ecs/world";
import { Transform } from "../render/components";
import { resolveCollisions } from "./collisions";
import { Body, Velocity } from "./components";
import { Gravity } from "./gravity";

/**
 * Built-in physics system: applies gravity, forces, impulses and damping to
 * every Body's Velocity, moves every Transform by its Velocity, then pushes
 * overlapping Colliders apart and applies the hits to their velocities.
 *
 * Add it with `scene.addSystem(physics)` after the systems that steer entities
 * (input, AI) and before those that react to where they ended up.
 */
export function physics(world: World, dt: number): void {
  accelerate(world, dt);
  move(world, dt);
  resolveCollisions(world, dt);
}

function accelerate(world: World, dt: number): void {
  const bodies = world.query(Velocity, Body);
  if (bodies.length === 0) return;
  const gravity = world.getResource(Gravity);
  for (const [, velocity, body] of bodies) {
    checkBody(body);
    const invMass = 1 / body.mass;
    velocity.x += (gravity.x * body.gravityScale + body.forceX * invMass) * dt;
    velocity.y += (gravity.y * body.gravityScale + body.forceY * invMass) * dt;
    velocity.x += body.impulseX * invMass;
    velocity.y += body.impulseY * invMass;
    body.forceX = body.forceY = body.impulseX = body.impulseY = 0;
    if (body.damping > 0) {
      // Frame-rate independent: loses the same fraction per second whatever the step.
      const keep = Math.pow(1 - body.damping, dt);
      velocity.x *= keep;
      velocity.y *= keep;
    }
  }
}

/** Velocity first, then position (semi-implicit Euler): stable for bouncing and orbits. */
function move(world: World, dt: number): void {
  for (const [, transform, velocity] of world.query(Transform, Velocity)) {
    transform.x += velocity.x * dt;
    transform.y += velocity.y * dt;
  }
}

/** Bad values (e.g. typed in the editor) would turn velocities into Infinity or NaN. */
function checkBody(body: Body): void {
  if (!(body.mass > 0)) {
    throw new Error(`Body mass must be positive, got ${String(body.mass)}`);
  }
  if (!(body.damping >= 0 && body.damping <= 1)) {
    throw new Error(`Body damping must be between 0 and 1, got ${String(body.damping)}`);
  }
}
