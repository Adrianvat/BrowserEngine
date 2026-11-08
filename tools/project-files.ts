import { formatSceneData } from "../src/engine/data/scene-files.ts";
import {
  formatProjectSettings,
  isProjectId,
  newProjectSettings,
  PROJECT_FILE,
  validateProjectSettings,
  type ProjectFile,
  type ProjectSettings,
} from "../src/engine/data/project-files.ts";
import {
  ApiError,
  join,
  parseBody,
  respond,
  type ApiRequest,
  type ApiResponse,
  type FileSystem,
} from "./api.ts";
import { handleImagesRequest, ImageFiles } from "./image-files.ts";
import { handleScenesRequest, SceneFiles } from "./scene-files.ts";
import { handleScriptsRequest, ScriptFiles } from "./script-files.ts";

/** The folders inside a project that have their own API. */
export const PROJECT_FOLDERS = ["scripts", "scenes", "images"] as const;
export type ProjectFolder = (typeof PROJECT_FOLDERS)[number];

/** What the dev server tells the pages about a changed file (src/dev-api/changes.ts). */
export interface FilesChange {
  project: string;
  folder: ProjectFolder | "settings";
  event: string;
  file: string;
}

/**
 * The change to tell the pages about for a path inside the projects folder (e.g.
 * "demo/scenes/play.json"), or null for a file that is not a project's.
 */
export function changeOf(inside: string, event: string): FilesChange | null {
  const [project, folder, ...rest] = inside.split("/");
  if (!project || !folder || !isProjectId(project)) return null;
  if (folder === PROJECT_FILE && rest.length === 0) return { project, folder: "settings", event, file: "" };
  if (!(PROJECT_FOLDERS as readonly string[]).includes(folder) || rest.length === 0) return null;
  return { project, folder: folder as ProjectFolder, event, file: rest.join("/") };
}

function checkId(id: string): void {
  if (!isProjectId(id)) throw new Error(`"${id}" is not a valid project id`);
}

/**
 * The projects as folders under a root (see engine/data/project-files): listing them,
 * making and deleting one, and writing one's settings. Every write goes to disk at once;
 * nothing is cached, so projects added with other tools are always seen.
 */
export class ProjectFiles {
  constructor(
    /** The projects folder, e.g. "projects". */
    readonly root: string,
    private readonly fs: FileSystem,
  ) {}

  /** Every project (a folder with a project.json), by id, with its settings file's text. */
  async list(): Promise<ProjectFile[]> {
    const projects: ProjectFile[] = [];
    for (const entry of (await this.fs.list(this.root)).sort()) {
      if (!isProjectId(entry)) continue;
      const text = await this.fs.read(join(this.root, entry, PROJECT_FILE));
      if (text !== null) projects.push({ id: entry, text });
    }
    return projects;
  }

  async has(id: string): Promise<boolean> {
    checkId(id);
    return (await this.fs.read(join(this.root, id, PROJECT_FILE))) !== null;
  }

  /** Makes a project with the starting settings and one empty scene. */
  async create(id: string, name: string): Promise<void> {
    checkId(id);
    if (await this.has(id)) throw new Error(`There is already a project "${id}"`);
    const settings = newProjectSettings(name);
    await this.fs.write(join(this.root, id, PROJECT_FILE), formatProjectSettings(settings));
    for (const scene of settings.scenes) {
      await this.fs.write(join(this.root, id, "scenes", `${scene}.json`), formatSceneData({ version: 1, entities: [] }));
    }
  }

  /** Deletes a project and all its files. */
  async remove(id: string): Promise<void> {
    checkId(id);
    await this.fs.removeFolder(join(this.root, id));
  }

  /** Writes an existing project's settings, keeping the file's line endings. */
  async writeSettings(id: string, settings: ProjectSettings): Promise<void> {
    if (!(await this.has(id))) throw new Error(`There is no project "${id}"`);
    const path = join(this.root, id, PROJECT_FILE);
    let text = formatProjectSettings(settings);
    if ((await this.fs.read(path))?.includes("\r\n")) text = text.replace(/\n/g, "\r\n");
    await this.fs.write(path, text);
  }

  /** The scripts of a project, as the scripts API needs them. */
  scripts(id: string): ScriptFiles {
    checkId(id);
    return new ScriptFiles(join(this.root, id, "scripts"), this.fs);
  }

  scenes(id: string): SceneFiles {
    checkId(id);
    return new SceneFiles(join(this.root, id, "scenes"), this.fs);
  }

  images(id: string): ImageFiles {
    checkId(id);
    return new ImageFiles(join(this.root, id, "images"), this.fs);
  }
}

/**
 * The projects API the editors talk to:
 *   GET    /                    -> { version: 1, projects: [{ id, text }] }
 *   POST   /                    { id, name }   makes a project
 *   DELETE /<id>
 *   PUT    /<id>/settings       { settings: ProjectSettings }
 *   *      /<id>/scripts/...    the scripts API (tools/script-files.ts) of that project
 *   *      /<id>/scenes/...     the scenes API (tools/scene-files.ts)
 *   *      /<id>/images/...     the images API (tools/image-files.ts)
 */
export function handleProjectsRequest(
  files: ProjectFiles,
  request: ApiRequest,
): Promise<ApiResponse> {
  return respond(async () => {
    const path = request.path.replace(/\/$/, "");
    if (path === "" && request.method === "GET") {
      return { status: 200, body: { version: 1, projects: await files.list() } };
    }
    if (path === "" && request.method === "POST") {
      const { id, name = "" } = parseBody(request.body);
      if (typeof id !== "string" || !isProjectId(id)) {
        throw new ApiError(400, `"id" must be a project id: letters, digits, _ and -`);
      }
      if (typeof name !== "string") throw new ApiError(400, '"name" must be a string');
      if (await files.has(id)) throw new ApiError(409, `There is already a project "${id}"`);
      await files.create(id, name);
      return { status: 200, body: { ok: true } };
    }
    const inProject = /^\/([^/]+)(?:\/(scripts|scenes|images)(\/.*)?|\/settings)?$/.exec(path);
    if (!inProject) throw new ApiError(404, `No such route: ${request.method} ${request.path}`);
    const [, id, folder, rest] = inProject;
    if (!isProjectId(id)) throw new ApiError(400, `"${id}" is not a valid project id`);
    if (folder) {
      if (!(await files.has(id))) throw new ApiError(404, `There is no project "${id}"`);
      const inner = { ...request, path: rest ?? "" };
      if (folder === "scripts") return handleScriptsRequest(files.scripts(id), inner);
      if (folder === "scenes") return handleScenesRequest(files.scenes(id), inner);
      return handleImagesRequest(files.images(id), inner);
    }
    if (path.endsWith("/settings") && request.method === "PUT") {
      if (!(await files.has(id))) throw new ApiError(404, `There is no project "${id}"`);
      let settings: ProjectSettings;
      try {
        settings = validateProjectSettings(parseBody(request.body).settings);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        throw new ApiError(400, `"settings" must be project settings: ${reason}`);
      }
      await files.writeSettings(id, settings);
      return { status: 200, body: { ok: true } };
    }
    if (!path.endsWith("/settings") && request.method === "DELETE") {
      if (!(await files.has(id))) throw new ApiError(404, `There is no project "${id}"`);
      await files.remove(id);
      return { status: 200, body: { ok: true } };
    }
    throw new ApiError(404, `No such route: ${request.method} ${request.path}`);
  });
}
