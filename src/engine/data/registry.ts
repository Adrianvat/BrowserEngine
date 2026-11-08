import { Animator } from "../animation/animator";
import type { ComponentType } from "../ecs/world";
import { Body, Collider, Velocity } from "../physics/components";
import { COLLIDER_SHAPES } from "../physics/shapes";
import { Circle, Layer, Rect, Sprite, Text, Transform } from "../render/components";

/** How a field is stored in scene data and edited in the editor. */
export type FieldKind =
  | "number"
  /** A number that may be empty (undefined), e.g. Sprite.width meaning "natural size". */
  | "optionalNumber"
  | "string"
  | "boolean"
  /** A CSS color string. */
  | "color"
  /** The name of a loaded image. */
  | "image"
  | { readonly choice: readonly string[] };

const SIMPLE_KINDS: readonly unknown[] = [
  "number",
  "optionalNumber",
  "string",
  "boolean",
  "color",
  "image",
];

/** Whether a value (e.g. from a script's `fields`) is a field kind. */
export function isFieldKind(value: unknown): value is FieldKind {
  if (SIMPLE_KINDS.includes(value)) return true;
  if (typeof value !== "object" || value === null || !("choice" in value)) return false;
  const { choice } = value as { choice: unknown };
  return (
    Array.isArray(choice) &&
    choice.length > 0 &&
    choice.every((option) => typeof option === "string")
  );
}

/** A component the editor can show and scene data can hold. */
export interface ComponentDefinition {
  readonly type: ComponentType;
  /** The name used in scene data (class names don't survive the production build). */
  readonly name: string;
  /** The fields saved in scene data and shown in the inspector. */
  readonly fields: Readonly<Record<string, FieldKind>>;
}

/** Declares an editable component. Its class must work with `new type()`. */
export function component<T>(
  type: new () => T,
  name: string,
  fields: { [K in keyof T]?: FieldKind },
): ComponentDefinition {
  return { type, name, fields: fields as Record<string, FieldKind> };
}

/**
 * The built-in components. With the game's collision layer names, a Collider's layer is
 * a choice among them instead of free text, so the editor cannot set one the game rejects.
 */
function builtInComponents(layerNames: readonly string[]): ComponentDefinition[] {
  return [
    component(Transform, "Transform", { x: "number", y: "number" }),
    component(Rect, "Rect", { width: "number", height: "number", color: "color" }),
    component(Circle, "Circle", { radius: "number", color: "color" }),
    component(Sprite, "Sprite", {
      image: "image",
      frame: "number",
      width: "optionalNumber",
      height: "optionalNumber",
      flipX: "boolean",
      flipY: "boolean",
    }),
    component(Layer, "Layer", { value: "number" }),
    component(Text, "Text", {
      value: "string",
      size: "number",
      color: "color",
      font: "string",
      align: { choice: ["left", "center", "right"] },
    }),
    component(Animator, "Animator", { clip: "string" }),
    component(Velocity, "Velocity", { x: "number", y: "number" }),
    component(Body, "Body", { mass: "number", gravityScale: "number", damping: "number" }),
    component(Collider, "Collider", {
      shape: { choice: COLLIDER_SHAPES },
      width: "number",
      height: "number",
      layer: layerNames.length > 0 ? { choice: layerNames } : "string",
      offsetX: "number",
      offsetY: "number",
      restitution: "number",
      friction: "number",
    }),
  ];
}

/** Every editable component: the built-in ones, then the game's own. */
export class ComponentRegistry {
  private readonly byName = new Map<string, ComponentDefinition>();
  private readonly byType = new Map<ComponentType, ComponentDefinition>();

  /**
   * `layerNames` are the game's collision layers (see `CollisionLayers.names`); with them,
   * a Collider's layer field offers those names only.
   */
  constructor(definitions: readonly ComponentDefinition[] = [], layerNames: readonly string[] = []) {
    for (const definition of [...builtInComponents(layerNames), ...definitions]) {
      if (this.byName.has(definition.name)) {
        throw new Error(`Component "${definition.name}" is already registered`);
      }
      this.byName.set(definition.name, definition);
      this.byType.set(definition.type, definition);
    }
  }

  get(name: string): ComponentDefinition | undefined {
    return this.byName.get(name);
  }

  nameOf(type: ComponentType): string | undefined {
    return this.byType.get(type)?.name;
  }

  all(): ComponentDefinition[] {
    return [...this.byName.values()];
  }
}
