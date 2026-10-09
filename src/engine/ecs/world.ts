/** An entity is just an ID. All of its data lives in component stores. */
export type Entity = number;

/** A component type is the class used to create the component. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ComponentType<T = unknown> = new (...args: any[]) => T;

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
}
