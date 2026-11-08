import { isProjectId, type ProjectFile, type ProjectSettings } from "../engine";
import { callApi, type ApiOptions } from "./call";

/** Where the API of a project's folder is mounted, for the scripts, scenes and images clients. */
export const PROJECTS_API = "/api/projects";

export function projectApiBase(projectId: string, folder: "scripts" | "scenes" | "images"): string {
  return `${PROJECTS_API}/${projectId}/${folder}`;
}

/** Where projects are kept: folders in the project's `projects/`, through the dev server's API. */
export interface ProjectsClient {
  /** Every project's settings file. Throws when the files can't be reached (no dev server, say). */
  load(): Promise<ProjectFile[]>;
  /** Makes a project with the starting settings. */
  create(id: string, name: string): Promise<void>;
  /** Deletes a project and all its files. */
  remove(id: string): Promise<void>;
  writeSettings(id: string, settings: ProjectSettings): Promise<void>;
}

function isProjectFile(value: unknown): value is ProjectFile {
  if (typeof value !== "object" || value === null) return false;
  const { id, text } = value as Record<string, unknown>;
  return typeof id === "string" && isProjectId(id) && typeof text === "string";
}

/** Checks the server's answer to GET /api/projects and returns its project files. */
export function validateProjectFiles(value: unknown): ProjectFile[] {
  const { version, projects } = (value ?? {}) as { version?: unknown; projects?: unknown };
  if (version !== 1 || !Array.isArray(projects) || !projects.every(isProjectFile)) {
    throw new Error("The projects API answered with something other than project files");
  }
  return projects.map(({ id, text }) => ({ id, text }));
}

/** The dev server's /api/projects (see tools/project-files.ts for the routes). */
export class ProjectsApi implements ProjectsClient {
  private readonly options: ApiOptions;

  constructor(base = PROJECTS_API, fetchFn?: typeof fetch) {
    this.options = { base, fetchFn };
  }

  async load(): Promise<ProjectFile[]> {
    return validateProjectFiles(await callApi(this.options, "GET", ""));
  }

  async create(id: string, name: string): Promise<void> {
    await callApi(this.options, "POST", "", { id, name });
  }

  async remove(id: string): Promise<void> {
    await callApi(this.options, "DELETE", `/${id}`);
  }

  async writeSettings(id: string, settings: ProjectSettings): Promise<void> {
    await callApi(this.options, "PUT", `/${id}/settings`, { settings });
  }
}
