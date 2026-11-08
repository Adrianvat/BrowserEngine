import { describe, it, expect } from "vitest";
import { FIXED_STEP } from "../../src/engine/core/timestep";
import { World } from "../../src/engine/ecs/world";
import { Body, Velocity } from "../../src/engine/physics/components";
import { Contacts } from "../../src/engine/physics/contacts";
import { Gravity } from "../../src/engine/physics/gravity";
import { physics } from "../../src/engine/physics/physics";
import { Transform } from "../../src/engine/render/components";

/** A world with gravity (0, 100) and one entity at the origin with the given components. */
function setup(...components: object[]) {
  const world = new World();
  const gravity = new Gravity(0, 100);
  world.setResource(gravity);
  world.setResource(new Contacts());
  const entity = world.spawn();
  for (const component of components) world.add(entity, component);
  return { world, gravity, entity };
}

/** Runs physics `count` times with the given dt. */
function step(world: World, count: number, dt: number): void {
  for (let i = 0; i < count; i++) physics(world, dt);
}

describe("Body", () => {
  it("has unit mass, full gravity and no damping by default", () => {
    expect(new Body()).toMatchObject({ mass: 1, gravityScale: 1, damping: 0 });
    expect(new Body({ mass: 3, gravityScale: 0.5, damping: 0.1 })).toMatchObject({
      mass: 3,
      gravityScale: 0.5,
      damping: 0.1,
    });
  });

  it("starts with nothing to apply", () => {
    expect(new Body()).toMatchObject({ forceX: 0, forceY: 0, impulseX: 0, impulseY: 0 });
  });

  it("adds up forces and impulses until the physics system uses them", () => {
    const body = new Body();
    body.applyForce(1, 2);
    body.applyForce(10, 20);
    body.applyImpulse(3, 4);
    body.applyImpulse(30, 40);
    expect(body).toMatchObject({ forceX: 11, forceY: 22, impulseX: 33, impulseY: 44 });
  });
});

describe("Gravity", () => {
  it("is off by default", () => {
    expect(new Gravity()).toMatchObject({ x: 0, y: 0 });
  });
});

describe("physics", () => {
  it("moves a Transform by its Velocity; without a Body gravity leaves it alone", () => {
    const transform = new Transform(0, 0);
    const velocity = new Velocity(10, -20);
    const { world } = setup(transform, velocity);
    physics(world, 0.5);
    expect([transform.x, transform.y]).toEqual([5, -10]);
    expect([velocity.x, velocity.y]).toEqual([10, -20]);
  });

  it("accelerates a Body by gravity, updating velocity before position", () => {
    const transform = new Transform(0, 0);
    const velocity = new Velocity();
    const { world } = setup(transform, velocity, new Body());
    physics(world, 0.1);
    expect(velocity.y).toBeCloseTo(10);
    expect(transform.y).toBeCloseTo(1);
    physics(world, 0.1);
    expect(velocity.y).toBeCloseTo(20);
    expect(transform.y).toBeCloseTo(3);
    expect([velocity.x, transform.x]).toEqual([0, 0]);
  });

  it("scales gravity per body: 0 floats, -1 falls up, 2 falls twice as fast", () => {
    const world = new World();
    world.setResource(new Gravity(0, 100));
    world.setResource(new Contacts());
    const velocities = [0, -1, 2].map((gravityScale) => {
      const velocity = new Velocity();
      const entity = world.spawn();
      world.add(entity, velocity);
      world.add(entity, new Body({ gravityScale }));
      return velocity;
    });
    physics(world, 0.1);
    expect(velocities.map((velocity) => velocity.y)).toEqual([0, -10, 20]);
  });

  it("follows the Gravity resource as it is at each step", () => {
    const velocity = new Velocity();
    const { world, gravity } = setup(velocity, new Body());
    physics(world, 0.1);
    gravity.x = 50;
    gravity.y = 0;
    physics(world, 0.1);
    expect([velocity.x, velocity.y]).toEqual([5, 10]);
    world.setResource(new Gravity(0, -100));
    physics(world, 0.1);
    expect([velocity.x, velocity.y]).toEqual([5, 0]);
  });

  it("accelerates a Body by force / mass for one step, then forgets the force", () => {
    const velocity = new Velocity();
    const body = new Body({ mass: 2, gravityScale: 0 });
    const { world } = setup(velocity, body);
    body.applyForce(20, -40);
    physics(world, 0.1);
    expect([velocity.x, velocity.y]).toEqual([1, -2]);
    expect([body.forceX, body.forceY]).toEqual([0, 0]);
    physics(world, 0.1);
    expect([velocity.x, velocity.y]).toEqual([1, -2]);
  });

  it("holds a body still when a force exactly cancels gravity", () => {
    const transform = new Transform(3, 4);
    const velocity = new Velocity();
    const body = new Body({ mass: 2 });
    const { world } = setup(transform, velocity, body);
    for (let i = 0; i < 10; i++) {
      body.applyForce(0, -200);
      physics(world, FIXED_STEP);
    }
    expect([velocity.x, velocity.y]).toEqual([0, 0]);
    expect([transform.x, transform.y]).toEqual([3, 4]);
  });

  it("changes velocity by impulse / mass at once, whatever the step, then forgets it", () => {
    const velocity = new Velocity(1, 0);
    const body = new Body({ mass: 4, gravityScale: 0 });
    const { world } = setup(velocity, body);
    body.applyImpulse(8, -20);
    physics(world, 0.01);
    expect([velocity.x, velocity.y]).toEqual([3, -5]);
    expect([body.impulseX, body.impulseY]).toEqual([0, 0]);
    physics(world, 1);
    expect([velocity.x, velocity.y]).toEqual([3, -5]);
  });

  it("applies an impulse and gravity in the same step, before moving", () => {
    const transform = new Transform(0, 0);
    const velocity = new Velocity();
    const body = new Body();
    const { world } = setup(transform, velocity, body);
    body.applyImpulse(0, -50);
    physics(world, 0.1);
    expect(velocity.y).toBeCloseTo(-40);
    expect(transform.y).toBeCloseTo(-4);
  });

  it("damping loses that fraction of velocity per second, whatever the step size", () => {
    // One second as ten steps of 0.1 s, and again as sixty fixed steps.
    const coarse = setup(new Velocity(100, -100), new Body({ damping: 0.5, gravityScale: 0 }));
    const fine = setup(new Velocity(100, -100), new Body({ damping: 0.5, gravityScale: 0 }));
    step(coarse.world, 10, 0.1);
    step(fine.world, 60, FIXED_STEP);
    for (const { world, entity } of [coarse, fine]) {
      const velocity = world.get(entity, Velocity)!;
      expect(velocity.x).toBeCloseTo(50);
      expect(velocity.y).toBeCloseTo(-50);
    }
  });

  it("damping 0 leaves velocity exactly as it is, and 1 stops the body dead", () => {
    const free = new Velocity(0.1, 0.3);
    const stuck = new Velocity(100, 100);
    const world = new World();
    world.setResource(new Gravity());
    world.setResource(new Contacts());
    const a = world.spawn();
    world.add(a, free);
    world.add(a, new Body({ damping: 0 }));
    const b = world.spawn();
    world.add(b, stuck);
    world.add(b, new Body({ damping: 1 }));
    step(world, 7, FIXED_STEP);
    expect([free.x, free.y]).toEqual([0.1, 0.3]);
    expect([stuck.x, stuck.y]).toEqual([0, 0]);
  });

  it("rejects a mass that is not positive", () => {
    for (const mass of [0, -1, NaN]) {
      const { world } = setup(new Velocity(), new Body({ mass }));
      expect(() => physics(world, FIXED_STEP)).toThrow(
        `Body mass must be positive, got ${String(mass)}`,
      );
    }
  });

  it("rejects damping outside 0 to 1", () => {
    for (const damping of [-0.1, 1.5, NaN]) {
      const { world } = setup(new Velocity(), new Body({ damping }));
      expect(() => physics(world, FIXED_STEP)).toThrow(
        `Body damping must be between 0 and 1, got ${String(damping)}`,
      );
    }
  });

  it("moves a Body's velocity even when it has no Transform", () => {
    const velocity = new Velocity();
    const { world } = setup(velocity, new Body());
    physics(world, 0.1);
    expect(velocity.y).toBeCloseTo(10);
  });

  it("ignores a Body without a Velocity", () => {
    const world = new World(); // no Gravity resource either
    world.setResource(new Contacts());
    const body = new Body();
    body.applyForce(5, 5);
    world.add(world.spawn(), body);
    world.add(world.spawn(), new Transform());
    expect(() => physics(world, FIXED_STEP)).not.toThrow();
    expect([body.forceX, body.forceY]).toEqual([5, 5]);
  });
});
