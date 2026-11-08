import { describe, it, expect } from "vitest";
import { World } from "../../src/engine/ecs/world";
import { Collider } from "../../src/engine/physics/components";
import { raycast } from "../../src/engine/physics/raycast";
import { Transform } from "../../src/engine/render/components";

function setup() {
  const world = new World();
  const add = (x: number, y: number, width: number, height: number, options = {}) => {
    const entity = world.spawn();
    world.add(entity, new Transform(x, y));
    world.add(entity, new Collider(width, height, options));
    return entity;
  };
  return { world, add };
}

/** The hit with its numbers rounded, to compare without float noise. */
function rounded(hit: ReturnType<typeof raycast>) {
  if (!hit) return hit;
  const r = (n: number) => Math.round(n * 1000) / 1000 + 0; // + 0 turns -0 into 0
  return { ...hit, x: r(hit.x), y: r(hit.y), distance: r(hit.distance), nx: r(hit.nx), ny: r(hit.ny) };
}

describe("raycast", () => {
  it("finds the nearest box along the ray, with the point, distance and face normal", () => {
    const { world, add } = setup();
    const far = add(0, 200, 100, 10);
    const near = add(0, 100, 100, 10);
    expect(raycast(world, 50, 0, 0, 1)).toEqual({ entity: near, x: 50, y: 100, distance: 100, nx: 0, ny: -1 });
    expect(raycast(world, 50, 300, 0, -1)).toEqual({ entity: far, x: 50, y: 210, distance: 90, nx: 0, ny: 1 });
    expect(raycast(world, -50, 105, 1, 0)).toMatchObject({ entity: near, x: 0, distance: 50, nx: -1, ny: 0 });
  });

  it("takes any direction length and diagonal rays", () => {
    const { world, add } = setup();
    const wall = add(100, 0, 10, 200);
    expect(rounded(raycast(world, 0, 0, 30, 30))).toEqual({
      entity: wall,
      x: 100,
      y: 100,
      distance: 141.421,
      nx: -1,
      ny: 0,
    });
  });

  it("misses what is beside, behind or beyond the max distance", () => {
    const { world, add } = setup();
    add(0, 100, 100, 10);
    expect(raycast(world, 150, 0, 0, 1)).toBeNull();
    expect(raycast(world, 50, 0, 0, -1)).toBeNull();
    expect(raycast(world, 50, 0, 0, 1, { maxDistance: 99 })).toBeNull();
    expect(raycast(world, 50, 0, 0, 1, { maxDistance: 100 })).not.toBeNull();
  });

  it("passes through colliders it starts inside, and ignored ones", () => {
    const { world, add } = setup();
    const self = add(0, 0, 20, 20);
    const other = add(0, 50, 20, 20);
    const beyond = add(0, 100, 20, 20);
    expect(raycast(world, 10, 10, 0, 1)?.entity).toBe(other);
    expect(raycast(world, 10, -10, 0, 1, { ignore: [self, other] })?.entity).toBe(beyond);
  });

  it("only hits the layers asked for", () => {
    const { world, add } = setup();
    add(0, 50, 100, 10, { layer: "pickup" });
    const ground = add(0, 100, 100, 10, { layer: "ground" });
    expect(raycast(world, 50, 0, 0, 1, { layers: ["ground"] })?.entity).toBe(ground);
  });

  it("hits a circle on its curve, with the normal pointing out from its center", () => {
    const { world, add } = setup();
    const ball = add(0, 0, 20, 20, { shape: "circle" }); // center 10, 10, radius 10
    expect(rounded(raycast(world, 10, -50, 0, 1))).toEqual({ entity: ball, x: 10, y: 0, distance: 50, nx: 0, ny: -1 });
    // Off-center: enters where the curve is, not at the box's edge.
    const hit = raycast(world, 16, -50, 0, 1)!;
    expect(hit.y).toBeCloseTo(2);
    expect(hit.nx).toBeCloseTo(0.6);
    expect(hit.ny).toBeCloseTo(-0.8);
    // Through the corner of the box it fits in, but outside the curve: a miss.
    expect(raycast(world, -10, 12, 1, -1)).toBeNull();
  });

  it("hits a capsule on its flat side and on its round caps", () => {
    const { world, add } = setup();
    const capsule = add(0, 0, 60, 20, { shape: "capsule" }); // caps centered at 10 and 50, y 10
    expect(rounded(raycast(world, 30, -50, 0, 1))).toEqual({ entity: capsule, x: 30, y: 0, distance: 50, nx: 0, ny: -1 });
    expect(rounded(raycast(world, -50, 10, 1, 0))).toEqual({ entity: capsule, x: 0, y: 10, distance: 50, nx: -1, ny: 0 });
    expect(rounded(raycast(world, 100, 10, -1, 0))).toEqual({ entity: capsule, x: 60, y: 10, distance: 40, nx: 1, ny: 0 });
    expect(raycast(world, -10, 12, 1, -1)).toBeNull(); // cuts the box's corner, outside the cap
    expect(raycast(world, 30, 10, 1, 0)).toBeNull(); // starts inside
  });

  it("rejects a zero direction", () => {
    const { world } = setup();
    expect(() => raycast(world, 0, 0, 0, 0)).toThrow("Raycast direction must not be zero, got 0, 0");
  });
});
