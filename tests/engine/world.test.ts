import { describe, it, expect, expectTypeOf } from "vitest";
import { World, type Entity } from "../../src/engine/ecs/world";

class Position {
  constructor(public x = 0, public y = 0) {}
}
class Velocity {
  constructor(public x = 0, public y = 0) {}
}
class Tag {}
class Name {
  constructor(public value = "") {}
}

describe("World entities", () => {
  it("spawns unique, increasing, alive entities", () => {
    const world = new World();
    const a = world.spawn();
    const b = world.spawn();
    expect(b).toBeGreaterThan(a);
    expect(world.isAlive(a)).toBe(true);
    expect(world.isAlive(b)).toBe(true);
  });

  it("despawn kills the entity and removes its components", () => {
    const world = new World();
    const e = world.spawn();
    world.add(e, new Position());
    world.despawn(e);
    expect(world.isAlive(e)).toBe(false);
    expect(world.has(e, Position)).toBe(false);
    expect(world.get(e, Position)).toBeUndefined();
  });

  it("despawn is a no-op for dead or unknown entities", () => {
    const world = new World();
    const e = world.spawn();
    world.despawn(e);
    expect(() => world.despawn(e)).not.toThrow();
    expect(() => world.despawn(9999)).not.toThrow();
  });

  it("never reuses IDs, and adding to a stale ID throws", () => {
    const world = new World();
    const old = world.spawn();
    world.despawn(old);
    const fresh = world.spawn();
    expect(fresh).not.toBe(old);
    expect(() => world.add(old, new Position())).toThrow(/not alive/);
  });
});

describe("World components", () => {
  it("add / get / has return the same instance", () => {
    const world = new World();
    const e = world.spawn();
    const pos = new Position(1, 2);
    world.add(e, pos);
    expect(world.has(e, Position)).toBe(true);
    expect(world.get(e, Position)).toBe(pos);
    expect(world.has(e, Velocity)).toBe(false);
    expect(world.get(e, Velocity)).toBeUndefined();
  });

  it("adding the same component type again replaces it", () => {
    const world = new World();
    const e = world.spawn();
    world.add(e, new Position(1, 1));
    const second = new Position(5, 5);
    world.add(e, second);
    expect(world.get(e, Position)).toBe(second);
  });

  it("remove deletes only that component and is a no-op if absent", () => {
    const world = new World();
    const e = world.spawn();
    world.add(e, new Position());
    world.add(e, new Velocity());
    world.remove(e, Position);
    expect(world.has(e, Position)).toBe(false);
    expect(world.has(e, Velocity)).toBe(true);
    expect(() => world.remove(e, Position)).not.toThrow();
    expect(world.isAlive(e)).toBe(true);
  });

  it("adding to a dead entity throws a descriptive error", () => {
    const world = new World();
    const e = world.spawn();
    world.despawn(e);
    expect(() => world.add(e, new Position())).toThrow(
      `Cannot add Position to entity ${e}: entity is not alive`,
    );
  });
});

describe("World.query", () => {
  it("returns only entities that have every requested component, in argument order", () => {
    const world = new World();
    const moving = world.spawn();
    const pos = new Position(1, 2);
    const vel = new Velocity(3, 4);
    world.add(moving, pos);
    world.add(moving, vel);
    const still = world.spawn();
    world.add(still, new Position());

    expect(world.query(Position, Velocity)).toEqual([[moving, pos, vel]]);
    const [row] = world.query(Velocity, Position);
    expect(row[1]).toBe(vel);
    expect(row[2]).toBe(pos);
    expect(world.query(Position).map(([e]) => e)).toEqual([moving, still]);
  });

  it("is fully typed", () => {
    // Name differs in shape from Position: TypeScript types are structural,
    // so two classes with identical fields would be indistinguishable here.
    const world = new World();
    expectTypeOf(world.query(Position, Name)).toEqualTypeOf<[Entity, Position, Name][]>();
    expectTypeOf(world.query(Name, Position)).toEqualTypeOf<[Entity, Name, Position][]>();
    expectTypeOf(world.query(Tag)).toEqualTypeOf<[Entity, Tag][]>();
  });

  it("works with field-less tag components", () => {
    const world = new World();
    const e = world.spawn();
    world.add(e, new Tag());
    expect(world.query(Tag).map(([id]) => id)).toEqual([e]);
  });

  it("returns an empty array for a component type that was never added", () => {
    const world = new World();
    const e = world.spawn();
    world.add(e, new Position());
    expect(world.query(Position, Velocity)).toEqual([]);
  });

  it("throws when called with no component types", () => {
    const world = new World();
    expect(() => world.query()).toThrow("query() requires at least one component type");
  });

  it("despawning during iteration is safe", () => {
    const world = new World();
    const ids = [world.spawn(), world.spawn(), world.spawn()];
    for (const id of ids) world.add(id, new Position());

    const visited: Entity[] = [];
    for (const [e] of world.query(Position)) {
      visited.push(e);
      world.despawn(e);
    }
    expect(visited).toEqual(ids);
    expect(world.query(Position)).toEqual([]);
  });

  it("entities added during iteration are not part of the current results", () => {
    const world = new World();
    world.add(world.spawn(), new Position());
    let count = 0;
    world.query(Position).forEach(() => {
      count++;
      world.add(world.spawn(), new Position());
    });
    expect(count).toBe(1);
    expect(world.query(Position)).toHaveLength(2);
  });
});

class Score {
  constructor(public value = 0) {}
}

describe("World resources", () => {
  it("setResource / getResource return the same, correctly typed instance", () => {
    const world = new World();
    const score = new Score(10);
    world.setResource(score);
    const got = world.getResource(Score);
    expectTypeOf(got).toEqualTypeOf<Score>();
    expect(got).toBe(score);
    expect(world.hasResource(Score)).toBe(true);
  });

  it("setResource replaces an existing resource of the same type", () => {
    const world = new World();
    world.setResource(new Score(1));
    const second = new Score(2);
    world.setResource(second);
    expect(world.getResource(Score)).toBe(second);
  });

  it("getResource throws a descriptive error when missing", () => {
    const world = new World();
    expect(world.hasResource(Score)).toBe(false);
    expect(() => world.getResource(Score)).toThrow(
      "Resource Score not found. Did you call world.setResource(new Score(...))?",
    );
  });
});
