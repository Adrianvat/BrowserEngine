import { describe, it, expect } from "vitest";
import { Animator } from "../../src/engine/animation/animator";
import { component, ComponentRegistry } from "../../src/engine/data/registry";
import { findByName, Name } from "../../src/engine/ecs/name";
import { World } from "../../src/engine/ecs/world";
import { Body, Collider, Velocity } from "../../src/engine/physics/components";
import { Circle, Layer, Rect, Sprite, Text, Transform } from "../../src/engine/render/components";

class Spin {
  constructor(public speed = 0) {}
}

describe("ComponentRegistry", () => {
  it("has the built-in components first, then the given ones", () => {
    const registry = new ComponentRegistry([component(Spin, "Spin", { speed: "number" })]);
    expect(registry.all().map((definition) => definition.name)).toEqual([
      "Transform",
      "Rect",
      "Circle",
      "Sprite",
      "Layer",
      "Text",
      "Animator",
      "Velocity",
      "Body",
      "Collider",
      "Spin",
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
    expect(registry.get("Circle")?.fields).toEqual({ radius: "number", color: "color" });
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
    expect(registry.get("Velocity")?.fields).toEqual({ x: "number", y: "number" });
    expect(registry.get("Body")?.fields).toEqual({
      mass: "number",
      gravityScale: "number",
      damping: "number",
    });
    expect(registry.get("Collider")?.fields).toEqual({
      shape: { choice: ["box", "circle", "capsule"] },
      width: "number",
      height: "number",
      layer: "string",
      offsetX: "number",
      offsetY: "number",
      restitution: "number",
      friction: "number",
    });
  });

  it("offers the game's collision layer names for a Collider's layer, or free text without them", () => {
    expect(new ComponentRegistry().get("Collider")?.fields.layer).toBe("string");
    const registry = new ComponentRegistry([], ["default", "player", "world"]);
    expect(registry.get("Collider")?.fields.layer).toEqual({
      choice: ["default", "player", "world"],
    });
  });

  it("finds a definition by name and a name by class", () => {
    const registry = new ComponentRegistry([component(Spin, "Spin", {})]);
    expect(registry.get("Spin")?.type).toBe(Spin);
    expect(registry.get("Nope")).toBeUndefined();
    expect(registry.nameOf(Sprite)).toBe("Sprite");
    expect(registry.nameOf(Spin)).toBe("Spin");
    expect(registry.nameOf(Name)).toBeUndefined();
  });

  it("rejects a name registered twice", () => {
    expect(
      () =>
        new ComponentRegistry([component(Spin, "Spin", {}), component(Spin, "Spin", {})]),
    ).toThrow('Component "Spin" is already registered');
  });

  it("rejects a game component that reuses a built-in's name", () => {
    expect(() => new ComponentRegistry([component(Spin, "Transform", {})])).toThrow(
      'Component "Transform" is already registered',
    );
    expect(() => new ComponentRegistry([component(Spin, "Velocity", {})])).toThrow(
      'Component "Velocity" is already registered',
    );
  });
});

describe("no-argument constructors", () => {
  it("give every built-in component usable defaults", () => {
    expect(new Transform()).toMatchObject({ x: 0, y: 0 });
    expect(new Rect()).toMatchObject({ width: 32, height: 32, color: "white" });
    expect(new Circle()).toMatchObject({ radius: 16, color: "white" });
    expect(new Sprite().image).toBe("");
    expect(new Layer().value).toBe(0);
    expect(new Text().value).toBe("");
    expect(new Animator().clip).toBe("");
    expect(new Velocity()).toMatchObject({ x: 0, y: 0 });
    expect(new Body()).toMatchObject({ mass: 1, gravityScale: 1, damping: 0 });
    expect(new Collider()).toMatchObject({
      shape: "box",
      width: 32,
      height: 32,
      restitution: 0,
      friction: 0.2,
    });
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
