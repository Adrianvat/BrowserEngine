import { describe, it, expect } from "vitest";
import { FIXED_STEP } from "../../src/engine/core/timestep";
import { World } from "../../src/engine/ecs/world";
import { colliderBox, resolveCollisions } from "../../src/engine/physics/collisions";
import { Body, Collider, Velocity } from "../../src/engine/physics/components";
import { Contacts } from "../../src/engine/physics/contacts";
import { Gravity } from "../../src/engine/physics/gravity";
import { CollisionLayers } from "../../src/engine/physics/layers";
import { physics } from "../../src/engine/physics/physics";
import { Transform } from "../../src/engine/render/components";

/** A world without gravity, plus helpers to add solids and to read where they are. */
function setup(gravity = new Gravity(), layers = new CollisionLayers()) {
  const world = new World();
  world.setResource(gravity);
  world.setResource(layers);
  const contacts = new Contacts();
  world.setResource(contacts);
  const spawn = (...components: object[]) => {
    const entity = world.spawn();
    for (const component of components) world.add(entity, component);
    return entity;
  };
  /** A wall or floor: a collider that never moves. */
  const wall = (x: number, y: number, width: number, height: number, options = {}) =>
    spawn(new Transform(x, y), new Collider(width, height, options));
  /** A 10x10 dynamic box with the given velocity. */
  const box = (x: number, y: number, vx = 0, vy = 0, body = new Body(), options = {}) =>
    spawn(new Transform(x, y), new Collider(10, 10, options), new Velocity(vx, vy), body);
  const at = (entity: number) => {
    const { x, y } = world.get(entity, Transform)!;
    return [x, y];
  };
  const speed = (entity: number) => {
    const { x, y } = world.get(entity, Velocity)!;
    return [x, y];
  };
  return { world, contacts, spawn, wall, box, at, speed };
}

describe("Collider", () => {
  it("is a 32x32 box at the Transform with no bounce and a little friction by default", () => {
    expect(new Collider()).toMatchObject({
      shape: "box",
      width: 32,
      height: 32,
      layer: "default",
      offsetX: 0,
      offsetY: 0,
      restitution: 0,
      friction: 0.2,
    });
    expect(
      new Collider(4, 5, { offsetX: 1, offsetY: 2, restitution: 0.5, friction: 0.9 }),
    ).toMatchObject({ width: 4, height: 5, offsetX: 1, offsetY: 2, restitution: 0.5, friction: 0.9 });
  });

  it("colliderBox places it at the Transform plus its offset", () => {
    const box = colliderBox(new Transform(10, 20), new Collider(30, 40, { offsetX: 1, offsetY: -2 }));
    expect(box).toEqual({ x: 11, y: 18, width: 30, height: 40 });
  });
});

describe("resolveCollisions", () => {
  it("pushes a box out of a wall along the axis it came in on and stops it there", () => {
    const { world, wall, box, at, speed } = setup();
    wall(0, 100, 100, 20);
    const falling = box(45, 93, 0, 100); // 3 px into the floor, moving down
    resolveCollisions(world, FIXED_STEP);
    expect(at(falling)).toEqual([45, 90]);
    expect(speed(falling)).toEqual([0, 0]);
  });

  it("resolves along the axis crossed most recently, not the shallower one", () => {
    const { world, wall, box, at } = setup();
    wall(0, 100, 100, 50);
    // A narrow box 8 px into a floor but only 10 px from its side: it was falling, so it
    // was the floor's top it crossed last, and it lands on top instead of slipping off.
    const falling = box(-2, 92, 0, 600);
    resolveCollisions(world, FIXED_STEP);
    expect(at(falling)).toEqual([-2, 90]);
  });

  it("never picks an axis whose overlap this step's motion could not have made", () => {
    const { world, wall, box, at } = setup();
    wall(100, -500, 64, 1000); // a tall wall
    // Nudged 0.1 px into the wall by a neighbour, no sideways speed, falling fast: the
    // 500 px overlap along y is not a hit, so it must come back out sideways.
    const pressed = box(90.1, 0, 0, 600);
    resolveCollisions(world, FIXED_STEP);
    expect(at(pressed)).toEqual([90, 0]);
  });

  it("with nothing moving, the shallower overlap decides, and ties go to y", () => {
    const { world, wall, box, at } = setup();
    wall(0, 100, 100, 50);
    const shallowX = box(-8, 94); // 2 px in from the left, 6 px in from the top
    resolveCollisions(world, FIXED_STEP);
    expect(at(shallowX)).toEqual([-10, 94]);
    world.despawn(shallowX);
    const corner = box(-5, 95); // 5 px in on both axes
    resolveCollisions(world, FIXED_STEP);
    expect(at(corner)).toEqual([-5, 90]);
  });

  it("leaves boxes that only touch alone", () => {
    const { world, wall, box, at, speed } = setup();
    wall(0, 100, 100, 20);
    const resting = box(45, 90, 30, 0);
    resolveCollisions(world, FIXED_STEP);
    expect(at(resting)).toEqual([45, 90]);
    expect(speed(resting)).toEqual([30, 0]);
  });

  it("bounces back with the higher of the two restitutions", () => {
    const { world, wall, box, speed } = setup();
    wall(0, 100, 100, 20, { restitution: 0.25 });
    const ball = box(45, 95, 20, 100, new Body(), { restitution: 0.5 });
    resolveCollisions(world, FIXED_STEP);
    expect(speed(ball)[1]).toBeCloseTo(-50);
  });

  it("does not bounce a hit slower than what gravity adds in a couple of steps", () => {
    const { world, wall, box, speed } = setup(new Gravity(0, 900));
    wall(0, 100, 100, 20);
    // Gravity adds 15 px/s per step; anything under 30 px/s is a resting contact.
    const settling = box(45, 99.9, 0, 20, new Body(), { restitution: 1 });
    const dropped = box(70, 99, 0, 40, new Body(), { restitution: 1 });
    resolveCollisions(world, FIXED_STEP);
    expect(speed(settling)).toEqual([0, 0]);
    expect(speed(dropped)).toEqual([0, -40]);
  });

  it("friction slows sliding by up to its share of the normal impulse", () => {
    const { world, wall, box, speed } = setup();
    wall(0, 100, 100, 20, { friction: 0.5 });
    // Normal impulse 100 (mass 1, 100 px/s down); friction sqrt(0.5 * 0.5) = 0.5 takes up to 50.
    const sliding = box(45, 95, 200, 100, new Body(), { friction: 0.5 });
    const creeping = box(70, 95, 30, 100, new Body(), { friction: 0.5 });
    resolveCollisions(world, FIXED_STEP);
    expect(speed(sliding)).toEqual([150, 0]);
    expect(speed(creeping)).toEqual([0, 0]);
  });

  it("has no friction when either collider is frictionless", () => {
    const { world, wall, box, speed } = setup();
    wall(0, 100, 100, 20, { friction: 0 });
    const sliding = box(45, 95, 200, 100, new Body(), { friction: 1 });
    resolveCollisions(world, FIXED_STEP);
    expect(speed(sliding)).toEqual([200, 0]);
  });

  it("separates two bodies by mass and trades momentum between them", () => {
    const { world, box, at, speed } = setup();
    const light = box(0, 0, 90, 0, new Body({ mass: 1 }));
    const heavy = box(7, 0, 0, 0, new Body({ mass: 2 })); // 3 px overlap
    resolveCollisions(world, FIXED_STEP);
    // The light one moves twice as far; together they keep the momentum of 90.
    expect(at(light)).toEqual([-2, 0]);
    expect(at(heavy)).toEqual([8, 0]);
    expect(speed(light)).toEqual([30, 0]);
    expect(speed(heavy)).toEqual([30, 0]);
  });

  it("a collider with a Velocity but no Body pushes bodies and is never pushed back", () => {
    const { world, spawn, box, at, speed } = setup();
    const platform = spawn(new Transform(0, 0), new Collider(50, 10), new Velocity(0, -20));
    const rider = box(20, -8, 0, 0); // on top, 2 px into the platform
    resolveCollisions(world, FIXED_STEP);
    expect(at(platform)).toEqual([0, 0]);
    expect(speed(platform)).toEqual([0, -20]);
    expect(at(rider)).toEqual([20, -10]);
    expect(speed(rider)).toEqual([0, -20]);
  });

  it("leaves pairs where neither side can be pushed alone", () => {
    const { world, spawn, wall, at } = setup();
    const a = wall(0, 0, 20, 20);
    const b = wall(10, 10, 20, 20);
    const mover = spawn(new Transform(5, 5), new Collider(20, 20), new Velocity(50, 0));
    resolveCollisions(world, FIXED_STEP);
    expect([at(a), at(b), at(mover)]).toEqual([
      [0, 0],
      [10, 10],
      [5, 5],
    ]);
  });

  it("ignores a Body without a Velocity, which cannot move", () => {
    const { world, spawn, box, at } = setup();
    const stuck = spawn(new Transform(0, 0), new Collider(20, 20), new Body());
    const mover = box(15, 5, 0, 0);
    resolveCollisions(world, FIXED_STEP);
    expect(at(stuck)).toEqual([0, 0]);
    expect(at(mover)).toEqual([20, 5]);
  });

  it("uses the collider's offset, not the Transform, as the solid box", () => {
    const { world, spawn, wall, at } = setup();
    wall(0, 100, 100, 20);
    const padded = spawn(
      new Transform(40, 80),
      new Collider(10, 10, { offsetX: 5, offsetY: 15 }), // the box is at (45, 95)
      new Velocity(0, 10),
      new Body(),
    );
    resolveCollisions(world, FIXED_STEP);
    expect(at(padded)).toEqual([40, 75]);
  });

  it("works out a stack: a box pushed out of the floor pushes the one on top of it", () => {
    const { world, wall, box, at } = setup(new Gravity(0, 980));
    wall(0, 100, 100, 20);
    const bottom = box(45, 92, 0, 10); // 2 px into the floor
    const top = box(45, 82, 0, 10); // sitting exactly on bottom
    resolveCollisions(world, FIXED_STEP);
    expect(at(bottom)).toEqual([45, 90]);
    expect(at(top)).toEqual([45, 80]);
  });

  it("needs no Gravity or layer resource while nothing moves", () => {
    const world = new World();
    world.setResource(new Contacts());
    const a = world.spawn();
    world.add(a, new Transform(0, 0));
    world.add(a, new Collider());
    const b = world.spawn();
    world.add(b, new Transform(10, 10));
    world.add(b, new Collider());
    expect(() => resolveCollisions(world, FIXED_STEP)).not.toThrow();
  });

  it("rejects a collider whose size is not positive", () => {
    for (const [width, height] of [[0, 10], [10, -5], [NaN, 10]]) {
      const { world, wall, box } = setup();
      wall(0, 100, width, height);
      box(0, 90);
      expect(() => resolveCollisions(world, FIXED_STEP)).toThrow(
        `Collider size must be positive, got ${String(width)}x${String(height)}`,
      );
    }
  });

  it("rejects restitution outside 0 to 1 and negative friction", () => {
    for (const restitution of [-0.5, 1.5]) {
      const { world, wall, box } = setup();
      wall(0, 100, 100, 10, { restitution });
      box(0, 90);
      expect(() => resolveCollisions(world, FIXED_STEP)).toThrow(
        `Collider restitution must be between 0 and 1, got ${String(restitution)}`,
      );
    }
    const { world, wall, box } = setup();
    wall(0, 100, 100, 10);
    box(0, 90, 0, 0, new Body(), { friction: -1 });
    expect(() => resolveCollisions(world, FIXED_STEP)).toThrow(
      "Collider friction must not be negative, got -1",
    );
  });
});

describe("contacts", () => {
  it("lists each touch of the step once, with the side it happened on", () => {
    const { world, contacts, wall, box } = setup();
    const floor = wall(0, 100, 100, 20);
    const crate = box(45, 92, 0, 10);
    const other = box(70, 95, 0, 10);
    resolveCollisions(world, FIXED_STEP);
    expect(contacts.all()).toHaveLength(2);
    expect(contacts.of(crate)).toEqual([{ entity: crate, other: floor, nx: 0, ny: 1 }]);
    expect(contacts.of(floor).map((contact) => contact.other)).toEqual([crate, other]);
    expect(contacts.between(crate, other)).toBe(false);
  });

  it("forgets the previous step's touches", () => {
    const { world, contacts, wall, box } = setup();
    wall(0, 100, 100, 20);
    const crate = box(45, 92, 0, -100);
    resolveCollisions(world, FIXED_STEP);
    expect(contacts.all()).toHaveLength(1);
    physics(world, FIXED_STEP); // Moves up and away.
    expect(contacts.all()).toEqual([]);
    expect(contacts.of(crate)).toEqual([]);
  });

  it("reports a pair that cannot be pushed apart, like a platform meeting a wall", () => {
    const { world, contacts, spawn, wall, at } = setup();
    const post = wall(50, 0, 10, 100);
    const platform = spawn(new Transform(10, 40), new Collider(50, 10), new Velocity(100, 0));
    resolveCollisions(world, FIXED_STEP);
    expect(contacts.between(platform, post)).toBe(true);
    expect(at(platform)).toEqual([10, 40]);
  });

  it("says nothing about two static colliders that overlap", () => {
    const { world, contacts, wall, box } = setup();
    wall(0, 0, 50, 50);
    wall(25, 25, 50, 50);
    box(200, 200, 1, 0); // So there is something moving.
    resolveCollisions(world, FIXED_STEP);
    expect(contacts.all()).toEqual([]);
  });
});

describe("collision layers", () => {
  const layers = () =>
    new CollisionLayers({
      player: { solid: ["world"], touch: ["coin"] },
      coin: { solid: ["world"] },
    });

  it("only reports a touch pair, leaving positions and velocities alone", () => {
    const { world, contacts, box, at, speed } = setup(new Gravity(), layers());
    const player = box(0, 0, 100, 0, new Body(), { layer: "player" });
    const coin = box(8, 0, 0, 0, new Body(), { layer: "coin" });
    resolveCollisions(world, FIXED_STEP);
    expect(contacts.of(player)).toEqual([{ entity: player, other: coin, nx: 1, ny: 0 }]);
    expect(at(player)).toEqual([0, 0]);
    expect(at(coin)).toEqual([8, 0]);
    expect(speed(player)).toEqual([100, 0]);
    expect(speed(coin)).toEqual([0, 0]);
  });

  it("keeps reporting a touch pair while they overlap", () => {
    const { world, contacts, box } = setup(new Gravity(), layers());
    const player = box(0, 0, 0, 0, new Body(), { layer: "player" });
    const coin = box(5, 0, 0, 0, new Body(), { layer: "coin" });
    for (let i = 0; i < 3; i++) {
      physics(world, FIXED_STEP);
      expect(contacts.between(player, coin)).toBe(true);
    }
  });

  it("pushes a solid pair apart and reports it", () => {
    const { world, contacts, wall, box, at } = setup(new Gravity(), layers());
    const floor = wall(0, 100, 100, 20, { layer: "world" });
    const player = box(45, 95, 0, 50, new Body(), { layer: "player" });
    resolveCollisions(world, FIXED_STEP);
    expect(at(player)).toEqual([45, 90]);
    expect(contacts.between(player, floor)).toBe(true);
  });

  it("ignores a pair whose layers are not listed together, not even as a touch", () => {
    const { world, contacts, box, at } = setup(new Gravity(), layers());
    const a = box(0, 0, 100, 0, new Body(), { layer: "coin" });
    const b = box(5, 0, 0, 0, new Body(), { layer: "coin" });
    resolveCollisions(world, FIXED_STEP);
    expect(contacts.all()).toEqual([]);
    expect([at(a), at(b)]).toEqual([
      [0, 0],
      [5, 0],
    ]);
  });

  it("throws for a collider on a layer the rules never name", () => {
    const { world, box } = setup(new Gravity(), layers());
    box(0, 0, 1, 0, new Body(), { layer: "player" });
    box(5, 0, 0, 0, new Body(), { layer: "playr" });
    expect(() => resolveCollisions(world, FIXED_STEP)).toThrow('Unknown collision layer "playr"');
  });

  it("keeps a collider fresh from the editor, on the default layer, solid against the rest", () => {
    const { world, contacts, box, at } = setup(new Gravity(), layers());
    const player = box(0, 0, 100, 0, new Body(), { layer: "player" });
    const fresh = box(6, 0, 0, 0, new Body()); // "default"
    resolveCollisions(world, FIXED_STEP);
    expect([at(player), at(fresh)]).toEqual([
      [-2, 0],
      [8, 0],
    ]);
    expect(contacts.between(player, fresh)).toBe(true);
  });

  it("treats every layer as solid when the game gave no rules", () => {
    const { world, contacts, box, at } = setup();
    const a = box(0, 0, 0, 0, new Body(), { layer: "anything" });
    const b = box(6, 0, 0, 0, new Body(), { layer: "else" });
    resolveCollisions(world, FIXED_STEP);
    expect([at(a), at(b)]).toEqual([
      [-2, 0],
      [8, 0],
    ]);
    expect(contacts.between(a, b)).toBe(true);
  });
});

describe("shapes", () => {
  it("pushes a circle off a floor and stops it, like a box", () => {
    const { world, wall, spawn, at, speed } = setup();
    wall(0, 100, 100, 20);
    const ball = spawn(
      new Transform(45, 93),
      new Collider(10, 10, { shape: "circle" }),
      new Velocity(0, 100),
      new Body(),
    );
    resolveCollisions(world, FIXED_STEP);
    expect(at(ball)).toEqual([45, 90]);
    expect(speed(ball)).toEqual([0, 0]);
  });

  it("bounces two circles off each other along the line between their centers", () => {
    const { world, contacts, spawn, speed } = setup();
    const ball = (x: number, y: number, vx: number) =>
      spawn(
        new Transform(x, y),
        new Collider(10, 10, { shape: "circle", restitution: 1, friction: 0 }),
        new Velocity(vx, 0),
        new Body(),
      );
    // Centers 4.8 right and 6.4 down: 8 apart with radii 5, so 2 px in along (0.6, 0.8).
    const a = ball(0, 0, 100);
    const b = ball(4.8, 6.4, 0);
    resolveCollisions(world, FIXED_STEP);
    const [contact] = contacts.of(a);
    expect(contact.nx).toBeCloseTo(0.6);
    expect(contact.ny).toBeCloseTo(0.8);
    // Elastic and equal masses: a's velocity along the normal (60) moves to b entirely.
    const [ax, ay] = speed(a);
    const [bx, by] = speed(b);
    expect(ax).toBeCloseTo(100 - 36);
    expect(ay).toBeCloseTo(-48);
    expect(bx).toBeCloseTo(36);
    expect(by).toBeCloseTo(48);
  });

  it("lets a circle roll off a box's corner instead of sitting on it", () => {
    const { world, wall, spawn, at } = setup(new Gravity(0, 980));
    wall(0, 100, 50, 50); // a ledge ending at x = 50
    const ball = spawn(
      new Transform(46, 80), // its center, at 51, hangs just over the edge
      new Collider(10, 10, { shape: "circle", friction: 0 }),
      new Velocity(),
      new Body(),
    );
    for (let i = 0; i < 60; i++) physics(world, FIXED_STEP);
    expect(at(ball)[0]).toBeGreaterThan(50);
    expect(at(ball)[1]).toBeGreaterThan(100);
  });

  it("a box stays on a corner where a circle would roll off", () => {
    const { world, wall, box, at } = setup(new Gravity(0, 980));
    wall(0, 100, 50, 50);
    const crate = box(46, 80);
    for (let i = 0; i < 60; i++) physics(world, FIXED_STEP);
    expect(at(crate)).toEqual([46, 90]);
  });

  it("stands a capsule on a floor and walks it into a wall", () => {
    const { world, wall, spawn, at, speed } = setup(new Gravity(0, 980));
    wall(0, 100, 200, 20);
    wall(100, 0, 20, 100);
    const velocity = new Velocity(300, 0);
    const hero = spawn(
      new Transform(50, 60),
      new Collider(20, 40, { shape: "capsule" }),
      velocity,
      new Body(),
    );
    for (let i = 0; i < 60; i++) {
      velocity.x = 300;
      physics(world, FIXED_STEP);
    }
    expect(at(hero)).toEqual([80, 60]);
    expect(speed(hero)).toEqual([0, 0]);
  });

  it("fits the shape into the collider's box, offset and all", () => {
    const { world, wall, spawn, at } = setup();
    wall(0, 100, 100, 20);
    // The collider is 20 below the Transform; the circle fills its 10x10 box.
    const ball = spawn(
      new Transform(45, 73),
      new Collider(10, 10, { shape: "circle", offsetY: 20 }),
      new Velocity(0, 10),
      new Body(),
    );
    resolveCollisions(world, FIXED_STEP);
    expect(at(ball)).toEqual([45, 70]);
  });

  it("piles circles without them sinking in", () => {
    const { world, wall, spawn, at } = setup(new Gravity(0, 980));
    wall(0, 100, 100, 20);
    wall(-20, 0, 20, 100);
    wall(100, 0, 20, 100);
    const balls = Array.from({ length: 12 }, (_, i) =>
      spawn(
        new Transform(5 + (i % 4) * 24, 70 - Math.floor(i / 4) * 24),
        new Collider(20, 20, { shape: "circle" }),
        new Velocity(),
        new Body(),
      ),
    );
    for (let i = 0; i < 300; i++) physics(world, FIXED_STEP);
    for (const ball of balls) {
      const [x, y] = at(ball);
      expect(y).toBeLessThanOrEqual(80 + 0.05);
      expect(x).toBeGreaterThanOrEqual(-0.05);
      expect(x).toBeLessThanOrEqual(80 + 0.05);
    }
  });
});

describe("physics with colliders", () => {
  it("lets a box fall onto a floor and come to rest exactly on it", () => {
    const { world, wall, box, at, speed } = setup(new Gravity(0, 980));
    wall(0, 100, 100, 20);
    const crate = box(45, 40);
    for (let i = 0; i < 120; i++) physics(world, FIXED_STEP);
    expect(at(crate)).toEqual([45, 90]);
    expect(speed(crate)).toEqual([0, 0]);
  });

  it("keeps a tall stack of boxes standing on each other, at rest", () => {
    const { world, wall, box, at, speed } = setup(new Gravity(0, 980));
    wall(0, 100, 100, 20);
    const crates = Array.from({ length: 10 }, (_, i) => box(45, 80 - 10 * i));
    for (let i = 0; i < 300; i++) physics(world, FIXED_STEP);
    crates.forEach((crate, i) => {
      expect(at(crate)[0]).toBe(45);
      expect(at(crate)[1]).toBeCloseTo(90 - 10 * i, 6);
      expect(speed(crate)).toEqual([0, 0]);
    });
  });

  it("slides a box to a halt on a rough floor", () => {
    const { world, wall, box, speed, at } = setup(new Gravity(0, 980));
    wall(0, 100, 1000, 20, { friction: 0.5 });
    const puck = box(0, 90, 300, 0, new Body(), { friction: 0.5 });
    for (let i = 0; i < 120; i++) physics(world, FIXED_STEP);
    // Deceleration is friction * gravity = 490 px/s²: 300 px/s stops in about 0.6 s.
    expect(speed(puck)).toEqual([0, 0]);
    expect(at(puck)[0]).toBeGreaterThan(80);
    expect(at(puck)[0]).toBeLessThan(100);
  });

  it("stops a box walking into a wall without leaving it inside", () => {
    const { world, wall, box, at } = setup();
    wall(100, 0, 50, 100);
    const walker = box(80, 45, 600, 0);
    for (let i = 0; i < 10; i++) physics(world, FIXED_STEP);
    expect(at(walker)).toEqual([90, 45]);
  });

  it("bounces a ball lower and lower until it rests", () => {
    const { world, wall, box, at, speed } = setup(new Gravity(0, 980));
    wall(0, 200, 100, 20);
    const ball = box(45, 0, 0, 0, new Body(), { restitution: 0.5 });
    const peaks: number[] = [];
    let lastY = 0;
    let rising = false;
    for (let i = 0; i < 600; i++) {
      physics(world, FIXED_STEP);
      const y = at(ball)[1];
      if (rising && y > lastY) peaks.push(lastY);
      rising = y < lastY;
      lastY = y;
    }
    expect(peaks.length).toBeGreaterThan(2);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeGreaterThan(peaks[i - 1]);
    expect(at(ball)).toEqual([45, 190]);
    expect(speed(ball)).toEqual([0, 0]);
  });
});
