/** An entity is just an ID. All of its data lives in component stores. */
export type Entity = number;

/** A component type is the class used to create the component. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ComponentType<T = unknown> = new (...args: any[]) => T;

/** Maps a tuple of component classes to a tuple of their instances. */
type InstancesOf<T extends ComponentType[]> = {
  [K in keyof T]: T[K] extends ComponentType<infer I> ? I : never;
};

export class World {
  private nextId = 1;
  private readonly alive = new Set<Entity>();
  /** One store per component class: entity -> component instance. */
  private readonly stores = new Map<ComponentType, Map<Entity, unknown>>();

  spawn(): Entity {
    const entity = this.nextId++;
    this.alive.add(entity);
    return entity;
  }

  despawn(entity: Entity): void {
    if (!this.alive.delete(entity)) return;
    for (const store of this.stores.values()) store.delete(entity);
  }

  isAlive(entity: Entity): boolean {
    return this.alive.has(entity);
  }

  add<T extends object>(entity: Entity, component: T): void {
    const type = component.constructor as ComponentType<T>;
    if (!this.alive.has(entity)) {
      throw new Error(`Cannot add ${type.name} to entity ${entity}: entity is not alive`);
    }
    let store = this.stores.get(type);
    if (!store) {
      store = new Map();
      this.stores.set(type, store);
    }
    store.set(entity, component);
  }

  remove(entity: Entity, type: ComponentType): void {
    this.stores.get(type)?.delete(entity);
  }

  get<T>(entity: Entity, type: ComponentType<T>): T | undefined {
    return this.stores.get(type)?.get(entity) as T | undefined;
  }

  has(entity: Entity, type: ComponentType): boolean {
    return this.stores.get(type)?.has(entity) ?? false;
  }

  /**
   * Returns [entity, ...components] for every entity that has all the given
   * component types. The result is a fresh array, so it is safe to spawn,
   * despawn, add or remove while looping over it.
   */
  query<T extends ComponentType[]>(...types: T): [Entity, ...InstancesOf<T>][] {
    if (types.length === 0) {
      throw new Error("query() requires at least one component type");
    }
    const stores: Map<Entity, unknown>[] = [];
    for (const type of types) {
      const store = this.stores.get(type);
      if (!store) return [];
      stores.push(store);
    }

    // Loop over the smallest store; only those entities can match.
    let smallest = stores[0];
    for (const store of stores) {
      if (store.size < smallest.size) smallest = store;
    }

    const results: unknown[][] = [];
    candidates: for (const entity of smallest.keys()) {
      const row: unknown[] = [entity];
      for (const store of stores) {
        if (!store.has(entity)) continue candidates;
        row.push(store.get(entity));
      }
      results.push(row);
    }
    return results as [Entity, ...InstancesOf<T>][];
  }
}
