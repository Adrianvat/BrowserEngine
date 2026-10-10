import { describe, it, expect } from "vitest";
import { component, ComponentRegistry } from "../../src/engine/data/registry";
import {
  parseSceneData,
  spawnSceneData,
  validateSceneData,
} from "../../src/engine/data/scene-data";
import { Name } from "../../src/engine/ecs/name";
import { World } from "../../src/engine/ecs/world";
import { Transform } from "../../src/engine/render/components";

/** A component with one field of every kind. */
class Gadget {
  count = 1;
  size?: number;
  label = "a";
  on = false;
  tint = "red";
  picture = "x";
  mode = "low";
}

const registry = new ComponentRegistry([
  component(Gadget, "Gadget", {
    count: "number",
    size: "optionalNumber",
    label: "string",
    on: "boolean",
    tint: "color",
    picture: "image",
    mode: { choice: ["low", "high"] },
  }),
]);

function scene(...entities: unknown[]) {
  return { version: 1, entities };
}

/** One entity named "G" with a Gadget holding these field values. */
function gadget(fields: Record<string, unknown>) {
  return scene({ name: "G", components: { Gadget: fields } });
}

describe("spawnSceneData", () => {
  it("spawns entities in order with their name and components", () => {
    const world = new World();
    const data = validateSceneData(
      scene(
        { name: "A", components: { Transform: { x: 1, y: 2 } } },
        { name: "B", components: {} },
      ),
      registry,
    );
    const [a, b] = spawnSceneData(world, data, registry);
    expect(world.get(a, Name)?.value).toBe("A");
    expect(world.get(a, Transform)).toEqual(new Transform(1, 2));
    expect(world.get(b, Name)?.value).toBe("B");
    expect(world.has(b, Transform)).toBe(false);
  });

  it("sets fields of every kind", () => {
    const values = {
      count: 5,
      size: 12,
      label: "hi",
      on: true,
      tint: "#ff0000",
      picture: "hero",
      mode: "high",
    };
    const world = new World();
    const [entity] = spawnSceneData(world, validateSceneData(gadget(values), registry), registry);
    const spawned = world.get(entity, Gadget);
    expect(spawned).toBeInstanceOf(Gadget);
    expect({ ...spawned }).toEqual(values);
  });

  it("keeps constructor defaults for fields the data leaves out", () => {
    const world = new World();
    const [entity] = spawnSceneData(
      world,
      validateSceneData(gadget({ count: 7 }), registry),
      registry,
    );
    expect({ ...world.get(entity, Gadget) }).toEqual({
      count: 7,
      label: "a",
      on: false,
      tint: "red",
      picture: "x",
      mode: "low",
    });
  });
});

describe("validateSceneData", () => {
  it("returns a copy, so editing the result leaves the input alone", () => {
    const input = scene({ name: "A", components: { Transform: { x: 1 } } });
    const data = validateSceneData(input, registry);
    data.entities[0].name = "B";
    data.entities[0].components.Transform.x = 9;
    expect(input).toEqual(scene({ name: "A", components: { Transform: { x: 1 } } }));
  });

  const shape = 'Scene data must be an object with "version" and "entities"';
  const entityShape = 'Entity 0 must have a "name" string and a "components" object';
  it.each([
    [null, shape],
    [[], shape],
    [{ version: 1 }, shape],
    [{ version: 2, entities: [] }, "Unsupported scene data version: 2"],
    [scene("nope"), entityShape],
    [scene({ name: 1, components: {} }), entityShape],
    [scene({ name: "A", components: [] }), entityShape],
    [
      scene({ name: "A", components: {} }, { name: "B", components: { Ghost: {} } }),
      'Entity 1 ("B"): unknown component "Ghost"',
    ],
    [
      scene({ name: "A", components: { Gadget: 3 } }),
      'Entity 0 ("A"): Gadget must be an object of field values',
    ],
    [gadget({ speed: 1 }), 'Entity 0 ("G"): Gadget has no field "speed"'],
    [gadget({ toString: "x" }), 'Entity 0 ("G"): Gadget has no field "toString"'],
    [gadget({ count: "1" }), 'Entity 0 ("G"): Gadget.count must be a number'],
    [gadget({ count: null }), 'Entity 0 ("G"): Gadget.count must be a number'],
    [gadget({ size: null }), 'Entity 0 ("G"): Gadget.size must be a number or empty'],
    [gadget({ label: 2 }), 'Entity 0 ("G"): Gadget.label must be a string'],
    [gadget({ on: "yes" }), 'Entity 0 ("G"): Gadget.on must be true or false'],
    [gadget({ tint: 0 }), 'Entity 0 ("G"): Gadget.tint must be a color'],
    [gadget({ picture: false }), 'Entity 0 ("G"): Gadget.picture must be an image name'],
    [gadget({ mode: "mid" }), 'Entity 0 ("G"): Gadget.mode must be one of low, high'],
  ])("rejects %j", (value, message) => {
    expect(() => validateSceneData(value, registry)).toThrow(message);
  });
});

describe("parseSceneData", () => {
  it("parses and validates JSON text", () => {
    const text = JSON.stringify(scene({ name: "A", components: { Transform: { x: 3 } } }));
    expect(parseSceneData(text, registry)).toEqual(
      scene({ name: "A", components: { Transform: { x: 3 } } }),
    );
  });

  it("rejects text that is not JSON", () => {
    expect(() => parseSceneData("{oops", registry)).toThrow("Scene data is not valid JSON: ");
  });

  it("rejects JSON that is not valid scene data", () => {
    expect(() => parseSceneData('{"version":3,"entities":[]}', registry)).toThrow(
      "Unsupported scene data version: 3",
    );
  });
});
