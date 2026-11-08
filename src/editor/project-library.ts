import type { ProjectsClient } from "../dev-api/projects";
import { isProjectId, type ProjectFile, type ProjectSettings } from "../engine";
import { settingsOf } from "../project/current";

/** One project as the project picker shows it. */
export interface ProjectEntry {
  id: string;
  /** The settings' name, or the id when there is none. */
  name: string;
  settings: ProjectSettings | null;
  /** Why the settings can't be read, if they can't. */
  error: string | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const READ_ONLY = "Projects can't be made or deleted here: start the dev server (npm run dev)";

/**
 * The projects there are (the folders under projects/), read from the dev server or
 * else the bundle, and making or deleting one.
 */
export class ProjectLibrary {
  private list: ProjectEntry[] = [];
  private readOnly = false;
  private error: string | null = null;
  private readonly listeners: (() => void)[] = [];

  constructor(
    private readonly client: ProjectsClient,
    /** What to show when the files can't be reached: the projects bundled with the page. */
    private readonly fallback?: () => Promise<readonly ProjectFile[]>,
  ) {}

  get entries(): readonly ProjectEntry[] {
    return this.list;
  }

  get ids(): string[] {
    return this.list.map((entry) => entry.id);
  }

  /** True when the files can't be reached; projects can't be made or deleted then. */
  get available(): boolean {
    return !this.readOnly;
  }

  /** Set when the projects could not be read at all. */
  get loadError(): string | null {
    return this.error;
  }

  get(id: string): ProjectEntry | undefined {
    return this.list.find((entry) => entry.id === id);
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** Reads the projects (or the fallback). Called at the start and whenever they changed on disk. */
  async load(): Promise<void> {
    this.error = null;
    let files: readonly ProjectFile[];
    try {
      files = await this.client.load();
      this.readOnly = false;
    } catch (error) {
      if (!this.fallback) {
        this.error = messageOf(error);
        this.notify();
        return;
      }
      try {
        files = await this.fallback();
        this.readOnly = true;
      } catch (fallbackError) {
        this.error = `${messageOf(error)}; ${messageOf(fallbackError)}`;
        this.notify();
        return;
      }
    }
    this.list = files.map((file) => {
      try {
        const settings = settingsOf(file);
        return { id: file.id, name: settings.name || file.id, settings, error: null };
      } catch (error) {
        return { id: file.id, name: file.id, settings: null, error: messageOf(error) };
      }
    });
    this.notify();
  }

  /** Why `id` can't be a new project's id, or null when it can. */
  idProblem(id: string): string | null {
    if (!isProjectId(id)) return "A project id is letters, digits, _ and -, starting with a letter or digit";
    if (this.get(id)) return `There is already a project "${id}"`;
    return null;
  }

  /** Makes a project with the starting settings; it is in the list once this resolves. */
  async create(id: string, name: string): Promise<void> {
    this.checkWritable();
    const problem = this.idProblem(id);
    if (problem !== null) throw new Error(problem);
    await this.client.create(id, name);
    await this.load();
  }

  /** Deletes a project and all its files. */
  async remove(id: string): Promise<void> {
    this.checkWritable();
    if (!this.get(id)) throw new Error(`There is no project "${id}"`);
    await this.client.remove(id);
    await this.load();
  }

  private checkWritable(): void {
    if (this.readOnly) throw new Error(READ_ONLY);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
