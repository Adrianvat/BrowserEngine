import type { SceneFilesClient } from "../dev-api/scenes";
import {
  CollisionLayers,
  ComponentRegistry,
  describeKind,
  fitsKind,
  formatSceneData,
  isSceneName,
  parseSceneData,
  sceneFile,
  type ComponentDefinition,
  type EntityData,
  type ProjectSettings,
  type SceneData,
  type SceneFile,
} from "../engine";

/**
 * Whether the scene files on disk match what is shown. "readOnly": the files can't be
 * reached (no dev server), so the bundled scenes are shown and edits stay in memory.
 * A failed write keeps the edit in memory and says why.
 */
export type SaveStatus = "saved" | "saving" | "readOnly" | { error: string };

export interface EditorModelOptions {
  /** The project's settings (project.json): its size, layers and scene list. */
  settings: ProjectSettings;
  /** The project's components, from its scripts; the built-in ones are always there. */
  components?: readonly ComponentDefinition[];
  /** The project's scene files, through the dev server. */
  files: SceneFilesClient;
  /** What to show when the files can't be reached: the scene files bundled with the page. */
  fallback?: () => Promise<readonly SceneFile[]>;
  /** Writes the project's settings after its scene list changed. */
  writeSettings?: (settings: ProjectSettings) => Promise<void>;
  /** The images sprites can use; none by default. */
  listImages?: () => string[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The scene being edited, the selection, and every change to them. The scenes are the
 * files in the project's scenes folder; each change writes the open scene's file at
 * once, one write after another, while the page never waits for the disk. The scene
 * list itself is in the project's settings, written the same way.
 */
export class EditorModel {
  /** The project's settings, as last read or written. */
  readonly settings: ProjectSettings;
  private componentRegistry: ComponentRegistry;
  /** Each scene file's text, as read from disk or as last written. */
  private texts = new Map<string, string>();
  private sceneName = "";
  private sceneData: SceneData = { version: 1, entities: [] };
  private selection: number | null = null;
  private saveStatus: SaveStatus = "saved";
  private error: string | null = null;
  private filesError: string | null = null;
  private pending = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners: (() => void)[] = [];
  private readonly files: SceneFilesClient;
  private readonly fallback: (() => Promise<readonly SceneFile[]>) | null;
  private readonly writeSettings: ((settings: ProjectSettings) => Promise<void>) | null;
  private readonly listImages: () => string[];

  constructor(options: EditorModelOptions) {
    this.settings = structuredClone(options.settings);
    this.files = options.files;
    this.fallback = options.fallback ?? null;
    this.writeSettings = options.writeSettings ?? null;
    this.listImages = options.listImages ?? (() => []);
    this.componentRegistry = this.makeRegistry(options.components ?? []);
    this.open(this.settings.firstScene);
  }

  /** The components scene data can use: the built-ins, then the game's own. */
  get registry(): ComponentRegistry {
    return this.componentRegistry;
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

  /** True when the files can't be reached; edits are then kept in memory only. */
  get readOnly(): boolean {
    return this.saveStatus === "readOnly";
  }

  /** Set when the open scene's file could not be read; editing waits for the file to be fixed. */
  get loadError(): string | null {
    return this.error;
  }

  /** The project's scenes, in its order. */
  get sceneNames(): string[] {
    return this.settings.scenes;
  }

  /** The scene the game starts in. */
  get firstScene(): string {
    return this.settings.firstScene;
  }

  get imageNames(): string[] {
    return this.listImages();
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** Reads the scene files (or the fallback) and opens the first scene. Called once at the start. */
  async load(): Promise<void> {
    this.filesError = null;
    try {
      this.setTexts(await this.files.load());
      this.saveStatus = "saved";
    } catch (error) {
      const reason = messageOf(error);
      if (this.fallback) {
        try {
          this.setTexts(await this.fallback());
          this.saveStatus = "readOnly";
        } catch (fallbackError) {
          this.filesError = `${reason}; ${messageOf(fallbackError)}`;
        }
      } else {
        this.filesError = reason;
      }
    }
    this.open(this.sceneName);
    this.notify();
  }

  /**
   * Re-reads the files after they changed on disk, e.g. in another editor. Nothing
   * changes while this editor's own writes are still on their way, or when read-only.
   */
  async reload(): Promise<void> {
    if (this.readOnly || this.pending > 0) return;
    let files: SceneFile[];
    try {
      files = await this.files.load();
    } catch (error) {
      this.filesError = messageOf(error);
      this.open(this.sceneName);
      this.notify();
      return;
    }
    if (this.pending > 0) return;
    const before = this.texts;
    this.filesError = null;
    this.setTexts(files);
    const changed = [...new Set([...before.keys(), ...this.texts.keys()])].filter(
      (name) => before.get(name) !== this.texts.get(name),
    );
    if (changed.length === 0 && this.error === null) return;
    if (changed.includes(this.sceneName) || this.error !== null) {
      const selection = this.selection;
      this.open(this.sceneName);
      if (selection !== null && selection < this.sceneData.entities.length) {
        this.selection = selection;
      }
    }
    this.notify();
  }

  /** Call when images were added, changed or removed, so views redraw. */
  imagesChanged(): void {
    this.notify();
  }

  /**
   * Replaces the game's own components (e.g. after the code editor changed a script) and
   * reads the scene again against them. The selection stays when its entity still exists.
   */
  setComponents(components: readonly ComponentDefinition[]): void {
    this.componentRegistry = this.makeRegistry(components);
    const selection = this.selection;
    this.open(this.sceneName);
    if (selection !== null && selection < this.sceneData.entities.length) {
      this.selection = selection;
    }
    this.notify();
  }

  /** Every scene's current data, for finding where an image is used. Unreadable scenes are left out. */
  allScenes(): Record<string, SceneData> {
    const scenes: Record<string, SceneData> = {};
    for (const name of this.sceneNames) {
      if (name === this.sceneName) {
        if (this.error === null) scenes[name] = this.sceneData;
        continue;
      }
      try {
        scenes[name] = this.read(name);
      } catch {
        // A broken scene is reported when it is opened; here it just has no usages.
      }
    }
    return scenes;
  }

  openScene(name: string): void {
    this.open(name);
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
    const x = Math.round(this.settings.width / 2);
    const y = Math.round(this.settings.height / 2);
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

  /** A field's value as the game will see it: the saved value, or the component's default. */
  fieldValue(index: number, name: string, field: string): unknown {
    const entity = this.entity(index);
    if (!Object.hasOwn(entity.components, name)) throw new Error(`Entity ${index} has no ${name}`);
    const fields = entity.components[name];
    if (Object.hasOwn(fields, field)) return fields[field];
    const definition = this.registry.get(name);
    return definition ? (new definition.type() as Record<string, unknown>)[field] : undefined;
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

  /** Why `name` can't be a new scene's name, or null when it can. */
  sceneNameProblem(name: string): string | null {
    if (!isSceneName(name)) return "A scene name is letters, digits, _ and -, starting with a letter or digit";
    if (this.settings.scenes.includes(name)) return `There is already a scene "${name}"`;
    return null;
  }

  /** Adds an empty scene to the project, writes its file and the settings, and opens it. */
  addScene(name: string): void {
    this.checkSettingsEditable();
    const problem = this.sceneNameProblem(name);
    if (problem !== null) throw new Error(problem);
    this.settings.scenes.push(name);
    if (this.settings.scenes.length === 1) this.settings.firstScene = name;
    const data: SceneData = { version: 1, entities: [] };
    this.texts.set(name, formatSceneData(data));
    void this.write(name, data);
    this.saveSettings();
    this.open(name);
    this.notify();
  }

  /** Takes a scene out of the project and deletes its file; the next scene is opened if it was open. */
  removeScene(name: string): void {
    this.checkSettingsEditable();
    const index = this.settings.scenes.indexOf(name);
    if (index < 0) throw new Error(`Scene "${name}" not found`);
    if (this.settings.scenes.length === 1) throw new Error("A project needs at least one scene");
    this.settings.scenes.splice(index, 1);
    if (this.settings.firstScene === name) this.settings.firstScene = this.settings.scenes[0];
    this.texts.delete(name);
    this.saveSettings();
    void this.run(() => this.files.remove(name));
    if (this.sceneName === name) this.open(this.settings.scenes[Math.min(index, this.settings.scenes.length - 1)]);
    this.notify();
  }

  /** Makes `name` the scene the game starts in. */
  setFirstScene(name: string): void {
    this.checkSettingsEditable();
    if (!this.settings.scenes.includes(name)) throw new Error(`Scene "${name}" not found`);
    this.settings.firstScene = name;
    this.saveSettings();
    this.notify();
  }

  /**
   * Replaces a scene's file with this data (e.g. a scene an older version of the editor
   * kept in the browser), checked against the components first. Resolves once written.
   */
  async importScene(name: string, text: string): Promise<void> {
    if (!this.settings.scenes.includes(name)) throw new Error(`Scene "${name}" not found`);
    if (this.readOnly) throw new Error("The scenes can't be changed here: start the dev server");
    const data = parseSceneData(text, this.registry);
    this.texts.set(name, formatSceneData(data));
    const written = this.write(name, data);
    if (name === this.sceneName) this.open(name);
    this.notify();
    await written;
  }

  private makeRegistry(components: readonly ComponentDefinition[]): ComponentRegistry {
    return new ComponentRegistry(
      components,
      new CollisionLayers(this.settings.collisionLayers).names,
    );
  }

  private checkSettingsEditable(): void {
    if (this.readOnly || !this.writeSettings) {
      throw new Error("The project's scenes can't be changed here: start the dev server");
    }
  }

  /** Writes the settings (the scene list) after the earlier writes. */
  private saveSettings(): void {
    const settings = structuredClone(this.settings);
    void this.run(() => this.writeSettings!(settings));
  }

  private setTexts(files: readonly SceneFile[]): void {
    // Line endings as formatSceneData writes them, so a file written here reads back the same.
    this.texts = new Map(files.map((file) => [file.name, file.text.replace(/\r\n/g, "\n")]));
  }

  /** A scene's data from its file, checked against the registry; a scene without a file is empty. */
  private read(name: string): SceneData {
    const text = this.texts.get(name);
    return text === undefined ? { version: 1, entities: [] } : parseSceneData(text, this.registry);
  }

  private open(name: string): void {
    if (!this.settings.scenes.includes(name)) throw new Error(`Scene "${name}" not found`);
    this.sceneName = name;
    this.sceneData = { version: 1, entities: [] };
    this.selection = null;
    this.error = null;
    if (this.filesError !== null) {
      this.error = `The scene files can't be read: ${this.filesError}`;
      return;
    }
    try {
      // A fresh copy of the file's data. It can fail when a component it uses is gone,
      // e.g. its script was removed in the code editor; then the file needs fixing.
      this.sceneData = this.read(name);
    } catch (error) {
      this.error = `Scene "${name}" (${sceneFile(name)}): ${messageOf(error)}`;
    }
  }

  /** Keeps the scene's text current and writes its file (unless read-only). */
  private save(): void {
    const text = formatSceneData(this.sceneData);
    this.texts.set(this.sceneName, text);
    if (!this.readOnly) void this.write(this.sceneName, JSON.parse(text) as SceneData);
    this.notify();
  }

  /** Writes a scene's file after the earlier writes; the status follows it. */
  private write(name: string, data: SceneData): Promise<void> {
    return this.run(() => this.files.write(name, data));
  }

  /** Runs a file change after the earlier ones; the status follows it. */
  private run(action: () => Promise<void>): Promise<void> {
    this.pending++;
    this.saveStatus = "saving";
    const result = this.queue.then(action).then(
      () => {
        this.pending--;
        if (this.pending === 0) {
          this.saveStatus = "saved";
          this.notify();
        }
      },
      (error: unknown) => {
        this.pending--;
        this.saveStatus = { error: messageOf(error) };
        this.notify();
        throw error;
      },
    );
    this.queue = result.catch(() => {});
    return result;
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
      throw new Error(`Scene "${this.sceneName}" could not be read; fix its file to edit it`);
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
