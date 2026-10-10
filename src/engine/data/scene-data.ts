import { Name } from "../ecs/name";
import type { Entity, World } from "../ecs/world";
import type { ComponentRegistry, FieldKind } from "./registry";

/** One entity in scene data: its name and its components' field values. */
export interface EntityData {
  name: string;
  /** Registered component name -> field values. */
  components: Record<string, Record<string, unknown>>;
}

/** A scene's starting entities, as saved by the editor. */
export interface SceneData {
  version: 1;
  entities: EntityData[];
}

const KIND_TEXT = {
  number: "a number",
  optionalNumber: "a number or empty",
  string: "a string",
  boolean: "true or false",
  color: "a color",
  image: "an image name",
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value can be stored in a field of this kind. */
export function fitsKind(kind: FieldKind, value: unknown): boolean {
  if (typeof kind === "object") return typeof value === "string" && kind.choice.includes(value);
  switch (kind) {
    case "number":
    case "optionalNumber":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
    case "color":
    case "image":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
  }
}

/** What a field of this kind must hold, for error messages. */
export function describeKind(kind: FieldKind): string {
  return typeof kind === "object" ? `one of ${kind.choice.join(", ")}` : KIND_TEXT[kind];
}

/** Parses saved scene data (JSON text) and checks it against the registry. */
export function parseSceneData(text: string, registry: ComponentRegistry): SceneData {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Scene data is not valid JSON: ${reason}`);
  }
  return validateSceneData(value, registry);
}

/** Checks scene data against the registry and returns a fresh copy of it. */
export function validateSceneData(value: unknown, registry: ComponentRegistry): SceneData {
  if (!isObject(value) || !("version" in value) || !Array.isArray(value.entities)) {
    throw new Error('Scene data must be an object with "version" and "entities"');
  }
  if (value.version !== 1) {
    throw new Error(`Unsupported scene data version: ${String(value.version)}`);
  }
  return {
    version: 1,
    entities: value.entities.map((entity, index) => validateEntity(entity, index, registry)),
  };
}

function validateEntity(entity: unknown, index: number, registry: ComponentRegistry): EntityData {
  if (!isObject(entity) || typeof entity.name !== "string" || !isObject(entity.components)) {
    throw new Error(`Entity ${index} must have a "name" string and a "components" object`);
  }
  const label = `Entity ${index} ("${entity.name}")`;
  const components: Record<string, Record<string, unknown>> = {};
  for (const [componentName, fields] of Object.entries(entity.components)) {
    const definition = registry.get(componentName);
    if (!definition) throw new Error(`${label}: unknown component "${componentName}"`);
    if (!isObject(fields)) {
      throw new Error(`${label}: ${componentName} must be an object of field values`);
    }
    const copy: Record<string, unknown> = {};
    for (const [field, fieldValue] of Object.entries(fields)) {
      // Own keys only, so inherited names like "toString" are not fields.
      if (!Object.hasOwn(definition.fields, field)) {
        throw new Error(`${label}: ${componentName} has no field "${field}"`);
      }
      const kind = definition.fields[field];
      if (!fitsKind(kind, fieldValue)) {
        throw new Error(`${label}: ${componentName}.${field} must be ${describeKind(kind)}`);
      }
      copy[field] = fieldValue;
    }
    components[componentName] = copy;
  }
  return { name: entity.name, components };
}

/**
 * Spawns one entity per entry, in order, with a Name and its components.
 * Each component is built with `new type()`, then gets the data's field values.
 */
export function spawnSceneData(
  world: World,
  data: SceneData,
  registry: ComponentRegistry,
): Entity[] {
  return data.entities.map((entityData) => {
    const entity = world.spawn();
    world.add(entity, new Name(entityData.name));
    for (const [componentName, fields] of Object.entries(entityData.components)) {
      const definition = registry.get(componentName);
      if (!definition) throw new Error(`Unknown component "${componentName}"`);
      const instance = new definition.type() as object;
      Object.assign(instance, fields);
      world.add(entity, instance);
    }
    return entity;
  });
}
