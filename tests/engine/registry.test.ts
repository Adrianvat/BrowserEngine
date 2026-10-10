import { describe, it, expect } from "vitest";
import { Animator } from "../../src/engine/animation/animator";
import { component, ComponentRegistry } from "../../src/engine/data/registry";
import { findByName, Name } from "../../src/engine/ecs/name";
import { World } from "../../src/engine/ecs/world";
import { Layer, Rect, Sprite, Text, Transform } from "../../src/engine/render/components";

class Velocity {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

describe("ComponentRegistry", () => {
  it("has the built-in components first, then the given ones", () => {
    const registry = new ComponentRegistry([
      component(Velocity, "Velocity", { x: "number", y: "number" }),
    ]);
    expect(registry.all().map((definition) => definition.name)).toEqual([
      "Transform",
      "Rect",
      "Sprite",
      "Layer",
      "Text",
      "Animator",
      "Velocity",
    ]);
  });

  it("describes each built-in's editable fields", () => {
    const registry = new ComponentRegistry();
    expect(registry.get("Transform")?.fields).toEqual({ x: "number", y: "number" });
    expect(registry.get("Rect")?.fields).toEqual({
      width: "number",
      height: "number",
      color: "color",
    });
    expect(registry.get("Sprite")?.fields).toEqual({
      image: "image",
      frame: "number",
      width: "optionalNumber",
      height: "optionalNumber",
      flipX: "boolean",
      flipY: "boolean",
    });
    expect(registry.get("Layer")?.fields).toEqual({ value: "number" });
    expect(registry.get("Text")?.fields).toEqual({
      value: "string",
      size: "number",
      color: "color",
      font: "string",
      align: { choice: ["left", "center", "right"] },
    });
    expect(registry.get("Animator")?.fields).toEqual({ clip: "string" });
  });

  it("finds a definition by name and a name by class", () => {
    const registry = new ComponentRegistry([component(Velocity, "Velocity", {})]);
    expect(registry.get("Velocity")?.type).toBe(Velocity);
    expect(registry.get("Nope")).toBeUndefined();
    expect(registry.nameOf(Sprite)).toBe("Sprite");
    expect(registry.nameOf(Velocity)).toBe("Velocity");
    expect(registry.nameOf(Name)).toBeUndefined();
  });

  it("rejects a name registered twice", () => {
    expect(
      () =>
        new ComponentRegistry([
          component(Velocity, "Velocity", {}),
          component(Velocity, "Velocity", {}),
        ]),
    ).toThrow('Component "Velocity" is already registered');
  });

  it("rejects a game component that reuses a built-in's name", () => {
    expect(() => new ComponentRegistry([component(Velocity, "Transform", {})])).toThrow(
      'Component "Transform" is already registered',
    );
  });
});

describe("no-argument constructors", () => {
  it("give every built-in component usable defaults", () => {
    expect(new Transform()).toMatchObject({ x: 0, y: 0 });
    expect(new Rect()).toMatchObject({ width: 32, height: 32, color: "white" });
    expect(new Sprite().image).toBe("");
    expect(new Layer().value).toBe(0);
    expect(new Text().value).toBe("");
    expect(new Animator().clip).toBe("");
    expect(new Name().value).toBe("");
  });
});

describe("findByName", () => {
  it("returns the first entity with that name, in spawn order", () => {
    const world = new World();
    const a = world.spawn();
    const b = world.spawn();
    const c = world.spawn();
    world.add(a, new Name("x"));
    // c gets its Name before b, so a plain store walk would find c first.
    world.add(c, new Name("y"));
    world.add(b, new Name("y"));
    expect(findByName(world, "y")).toBe(b);
  });

  it("returns undefined when no entity has that name", () => {
    const world = new World();
    world.add(world.spawn(), new Name("x"));
    expect(findByName(world, "z")).toBeUndefined();
  });
});
