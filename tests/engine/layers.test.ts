import { describe, it, expect } from "vitest";
import { CollisionLayers } from "../../src/engine/physics/layers";

describe("CollisionLayers", () => {
  it("makes every layer solid against every other when no rules are given", () => {
    const layers = new CollisionLayers();
    expect(layers.configured).toBe(false);
    expect(layers.names).toEqual([]);
    expect(layers.interaction("default", "default")).toBe("solid");
    expect(layers.interaction("anything", "else")).toBe("solid");
  });

  it("reads solid and touch rules both ways, and nothing for pairs left out", () => {
    const layers = new CollisionLayers({
      player: { solid: ["world"], touch: ["coin"] },
      rect: { solid: ["world", "rect"] },
    });
    expect(layers.configured).toBe(true);
    expect(layers.interaction("player", "world")).toBe("solid");
    expect(layers.interaction("world", "player")).toBe("solid");
    expect(layers.interaction("coin", "player")).toBe("touch");
    expect(layers.interaction("rect", "rect")).toBe("solid");
    expect(layers.interaction("player", "rect")).toBe("none");
    expect(layers.interaction("world", "world")).toBe("none");
    expect(layers.interaction("coin", "coin")).toBe("none");
  });

  it("keeps the default layer (a fresh Collider's) solid against everything", () => {
    const layers = new CollisionLayers({ player: { solid: ["world"], touch: ["coin"] } });
    for (const other of ["default", "player", "world", "coin"]) {
      expect(layers.interaction("default", other), other).toBe("solid");
      expect(layers.interaction(other, "default"), other).toBe("solid");
    }
  });

  it("lets the rules override how the default layer meets a layer", () => {
    const layers = new CollisionLayers({ default: { touch: ["coin"] }, coin: { solid: ["world"] } });
    expect(layers.interaction("default", "coin")).toBe("touch");
    expect(layers.interaction("default", "world")).toBe("solid");
    expect(layers.interaction("default", "default")).toBe("solid");
  });

  it("knows the default layer and every layer named anywhere in the rules", () => {
    const layers = new CollisionLayers({ player: { solid: ["world"], touch: ["coin"] }, ghost: {} });
    expect(layers.names).toEqual(["default", "player", "world", "coin", "ghost"]);
  });

  it("rejects a layer the rules never name", () => {
    const layers = new CollisionLayers({ player: { solid: ["world"] } });
    expect(() => layers.interaction("player", "playr")).toThrow('Unknown collision layer "playr"');
    expect(() => layers.interaction("nope", "world")).toThrow('Unknown collision layer "nope"');
  });

  it("rejects a pair listed as both solid and touch", () => {
    expect(
      () => new CollisionLayers({ player: { solid: ["rect"] }, rect: { touch: ["player"] } }),
    ).toThrow('Collision layers "rect" and "player" are listed as both solid and touch');
    expect(() => new CollisionLayers({ a: { solid: ["a"], touch: ["a"] } })).toThrow(
      'Collision layers "a" and "a" are listed as both solid and touch',
    );
  });

  it("accepts the same rule given from both sides", () => {
    const layers = new CollisionLayers({ a: { solid: ["b"] }, b: { solid: ["a"] } });
    expect(layers.interaction("a", "b")).toBe("solid");
  });
});
