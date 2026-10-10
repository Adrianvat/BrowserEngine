import type { ComponentRegistry, SceneData } from "../engine";

/** An entity that shows an image. */
export interface ImageUsage {
  scene: string;
  entity: string;
}

/** Every entity, in every scene, with an image field (e.g. Sprite.image) set to `image`. */
export function imageUsages(
  image: string,
  scenes: Record<string, SceneData>,
  registry: ComponentRegistry,
): ImageUsage[] {
  const usages: ImageUsage[] = [];
  for (const [scene, data] of Object.entries(scenes)) {
    for (const entity of data.entities) {
      const uses = Object.entries(entity.components).some(([name, fields]) => {
        const definition = registry.get(name);
        if (!definition) return false;
        return Object.entries(definition.fields).some(
          ([field, kind]) => kind === "image" && fields[field] === image,
        );
      });
      if (uses) usages.push({ scene, entity: entity.name });
    }
  }
  return usages;
}

/** "Hero (play), Logo (title)" */
export function formatUsages(usages: ImageUsage[]): string {
  return usages.map(({ scene, entity }) => `${entity || "(unnamed)"} (${scene})`).join(", ");
}
