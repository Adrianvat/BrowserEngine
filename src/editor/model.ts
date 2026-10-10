import {
  ComponentRegistry,
  describeKind,
  fitsKind,
  parseSceneData,
  validateSceneData,
  type EntityData,
  type GameDefinition,
  type SceneData,
  type SceneStore,
} from "../engine";

/** Whether the current scene is saved. A failed save keeps the edit in memory. */
export type SaveStatus = "saved" | "default" | { error: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The scene being edited, the selection, and every change to them. Each change is saved. */
export class EditorModel {
  readonly registry: ComponentRegistry;
  private sceneName = "";
  private sceneData: SceneData = { version: 1, entities: [] };
  private selection: number | null = null;
  private saveStatus: SaveStatus = "default";
  private error: string | null = null;
  private readonly listeners: (() => void)[] = [];

  constructor(
    readonly definition: GameDefinition,
    private readonly store: SceneStore,
  ) {
    this.registry = new ComponentRegistry(definition.components);
    this.load(definition.firstScene);
  }

  get scene(): string {
    return this.sceneName;
  }

  get data(): SceneData {
    return this.sceneData;
  }

  /** Index into data.entities, or null. */
  get selected(): number | null {
    return this.selection;
  }

  get status(): SaveStatus {
    return this.saveStatus;
  }

  /** Set when the scene's saved copy could not be loaded; editing waits for a reset. */
  get loadError(): string | null {
    return this.error;
  }

  get sceneNames(): string[] {
    return Object.keys(this.definition.scenes);
  }

  get imageNames(): string[] {
    return Object.keys(this.definition.images);
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  openScene(name: string): void {
    this.load(name);
    this.notify();
  }

  select(index: number | null): void {
    if (index !== null) this.entity(index);
    this.selection = index;
    this.notify();
  }

  /** Appends "Entity N" with a Transform at the center of the scene, and selects it. */
  addEntity(): void {
    this.checkEditable();
    const used = new Set(this.sceneData.entities.map((entity) => entity.name));
    let n = 1;
    while (used.has(`Entity ${n}`)) n++;
    const x = Math.round(this.definition.width / 2);
    const y = Math.round(this.definition.height / 2);
    this.sceneData.entities.push({ name: `Entity ${n}`, components: { Transform: { x, y } } });
    this.selection = this.sceneData.entities.length - 1;
    this.save();
  }

  removeEntity(index: number): void {
    this.editableEntity(index);
    this.sceneData.entities.splice(index, 1);
    if (this.selection === index) this.selection = null;
    else if (this.selection !== null && this.selection > index) this.selection--;
    this.save();
  }

  rename(index: number, name: string): void {
    this.editableEntity(index).name = name;
    this.save();
  }

  /** Adds a component with its constructor defaults; an empty image field gets the first image. */
  addComponent(index: number, name: string): void {
    const entity = this.editableEntity(index);
    const definition = this.registry.get(name);
    if (!definition) throw new Error(`Unknown component "${name}"`);
    if (Object.hasOwn(entity.components, name)) {
      throw new Error(`Entity ${index} already has ${name}`);
    }
    const instance = new definition.type() as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const [field, kind] of Object.entries(definition.fields)) {
      let value = instance[field];
      if (kind === "image" && value === "") value = this.imageNames[0] ?? "";
      if (value !== undefined) fields[field] = value;
    }
    entity.components[name] = fields;
    this.save();
  }

  removeComponent(index: number, name: string): void {
    this.componentFields(index, name);
    delete this.sceneData.entities[index].components[name];
    this.save();
  }

  /** Sets a field; `undefined` empties an optional number. */
  setField(index: number, name: string, field: string, value: unknown): void {
    const fields = this.componentFields(index, name);
    const definition = this.registry.get(name);
    if (!definition || !Object.hasOwn(definition.fields, field)) {
      throw new Error(`${name} has no field "${field}"`);
    }
    const kind = definition.fields[field];
    if (value === undefined && kind === "optionalNumber") {
      delete fields[field];
    } else if (fitsKind(kind, value)) {
      fields[field] = value;
    } else {
      throw new Error(`${name}.${field} must be ${describeKind(kind)}`);
    }
    this.save();
  }

  /** Moves an entity to whole pixels. A drag passes `save = false` until it ends. */
  move(index: number, x: number, y: number, save = true): void {
    const entity = this.editableEntity(index);
    const transform = (entity.components.Transform ??= {});
    transform.x = Math.round(x);
    transform.y = Math.round(y);
    if (save) this.save();
    else this.notify();
  }

  /** Deletes the saved copy and goes back to the scene's default data. */
  resetScene(): void {
    let failure: string | null = null;
    try {
      this.store.reset(this.sceneName);
    } catch (error) {
      failure = messageOf(error);
    }
    this.load(this.sceneName);
    if (failure !== null) this.saveStatus = { error: failure };
    this.notify();
  }

  private load(name: string): void {
    const entry = Object.hasOwn(this.definition.scenes, name)
      ? this.definition.scenes[name]
      : undefined;
    if (!entry) throw new Error(`Scene "${name}" not found`);
    let fallback: SceneData;
    try {
      // A fresh copy, so edits never change the imported default.
      fallback = validateSceneData(entry.data, this.registry);
    } catch (error) {
      throw new Error(`Scene "${name}": ${messageOf(error)}`, { cause: error });
    }
    this.sceneName = name;
    this.sceneData = fallback;
    this.selection = null;
    this.saveStatus = "default";
    this.error = null;
    try {
      const saved = this.store.load(name);
      if (saved === null) return;
      this.sceneData = parseSceneData(saved, this.registry);
      this.saveStatus = "saved";
    } catch (error) {
      this.error = `Scene "${name}": ${messageOf(error)}`;
    }
  }

  private save(): void {
    try {
      this.store.save(this.sceneName, this.sceneData);
      this.saveStatus = "saved";
    } catch (error) {
      this.saveStatus = { error: messageOf(error) };
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private entity(index: number): EntityData {
    const entity = Number.isInteger(index) ? this.sceneData.entities[index] : undefined;
    if (!entity) throw new Error(`No entity at index ${index}`);
    return entity;
  }

  private checkEditable(): void {
    if (this.error !== null) {
      throw new Error(`Scene "${this.sceneName}" could not be loaded; reset it to edit it`);
    }
  }

  private editableEntity(index: number): EntityData {
    this.checkEditable();
    return this.entity(index);
  }

  private componentFields(index: number, name: string): Record<string, unknown> {
    const entity = this.editableEntity(index);
    if (!Object.hasOwn(entity.components, name)) throw new Error(`Entity ${index} has no ${name}`);
    return entity.components[name];
  }
}
