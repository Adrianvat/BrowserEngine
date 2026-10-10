import { Animator } from "../animation/animator";
import type { ComponentType } from "../ecs/world";
import { Layer, Rect, Sprite, Text, Transform } from "../render/components";

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

const builtInComponents: readonly ComponentDefinition[] = [
  component(Transform, "Transform", { x: "number", y: "number" }),
  component(Rect, "Rect", { width: "number", height: "number", color: "color" }),
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
];

/** Every editable component: the built-in ones, then the game's own. */
export class ComponentRegistry {
  private readonly byName = new Map<string, ComponentDefinition>();
  private readonly byType = new Map<ComponentType, ComponentDefinition>();

  constructor(definitions: readonly ComponentDefinition[] = []) {
    for (const definition of [...builtInComponents, ...definitions]) {
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
