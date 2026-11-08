import type { Entity } from "../ecs/world";

/** Two colliders that touched during the last physics step, seen from `entity`'s side. */
export interface Contact {
  readonly entity: Entity;
  readonly other: Entity;
  /**
   * Which side of `entity` the other one is on, as a unit vector: (1, 0) its right, (0, 1)
   * below it, and so on. Boxes meet along an axis; circles and capsules can meet at any angle.
   */
  readonly nx: number;
  readonly ny: number;
}

/**
 * What touched what in the last physics step. A global resource, filled by the physics
 * system, so a system added after it can react (pick-ups, damage, landing). An entity
 * in here may already have been despawned by an earlier system in the same step.
 */
export class Contacts {
  private readonly pairs: Contact[] = [];
  private readonly byEntity = new Map<Entity, Contact[]>();

  /** Every touch of the step, each pair once. */
  all(): readonly Contact[] {
    return this.pairs;
  }

  /** The touches involving this entity, seen from its side. */
  of(entity: Entity): readonly Contact[] {
    return this.byEntity.get(entity) ?? [];
  }

  /** Whether these two touched. */
  between(a: Entity, b: Entity): boolean {
    return this.of(a).some((contact) => contact.other === b);
  }

  /** Called by the physics system at the start of each step. */
  clear(): void {
    this.pairs.length = 0;
    this.byEntity.clear();
  }

  /** Called by the physics system: a touch, with the normal pointing from `a` to `b`. */
  add(a: Entity, b: Entity, nx: number, ny: number): void {
    if (this.between(a, b)) return;
    const fromA: Contact = { entity: a, other: b, nx, ny };
    const fromB: Contact = { entity: b, other: a, nx: 0 - nx, ny: 0 - ny }; // 0 - 0 is 0, not -0
    this.pairs.push(fromA);
    this.list(a).push(fromA);
    this.list(b).push(fromB);
  }

  private list(entity: Entity): Contact[] {
    let list = this.byEntity.get(entity);
    if (!list) {
      list = [];
      this.byEntity.set(entity, list);
    }
    return list;
  }
}
