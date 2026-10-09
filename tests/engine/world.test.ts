import { describe, it, expect } from "vitest";
import { World } from "../../src/engine/ecs/world";

class Position {
  constructor(public x = 0, public y = 0) {}
}
class Velocity {
  constructor(public x = 0, public y = 0) {}
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
