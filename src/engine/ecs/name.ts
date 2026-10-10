import type { Entity, World } from "./world";

/** An entity's name, as shown and edited in the editor. */
export class Name {
  constructor(public value = "") {}
}

/** The first entity, in spawn order, with this name. */
export function findByName(world: World, name: string): Entity | undefined {
  let found: Entity | undefined;
  for (const [entity, entityName] of world.query(Name)) {
    if (entityName.value === name && (found === undefined || entity < found)) found = entity;
  }
  return found;
}
