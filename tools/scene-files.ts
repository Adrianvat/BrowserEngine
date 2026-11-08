import type { SceneData } from "../src/engine/data/scene-data.ts";
import {
  collectSceneFiles,
  formatSceneData,
  isSceneName,
  sceneFile,
  validateSceneShape,
  type SceneFile,
} from "../src/engine/data/scene-files.ts";
import {
  ApiError,
  join,
  parseBody,
  respond,
  type ApiRequest,
  type ApiResponse,
  type FileSystem,
} from "./api.ts";

/**
 * A project's scenes as files in a folder (see engine/data/scene-files): reading them all
 * and writing one. Every write goes to disk at once; nothing is cached, so edits made
 * with other tools are always seen.
 */
export class SceneFiles {
  constructor(
    /** The scenes folder, e.g. "projects/demo/scenes". */
    private readonly root: string,
    private readonly fs: FileSystem,
  ) {}

  /** Every scene file, by name. */
  async list(): Promise<SceneFile[]> {
    const files: Record<string, string> = {};
    for (const entry of await this.fs.list(this.root)) {
      if (!entry.endsWith(".json")) continue;
      const text = await this.fs.read(join(this.root, entry));
      if (text !== null) files[entry] = text;
    }
    return collectSceneFiles(files);
  }

  /** Writes a scene's file, formatted one component per line, keeping its line endings. */
  async write(name: string, data: SceneData): Promise<void> {
    if (!isSceneName(name)) throw new Error(`"${name}" is not a valid scene name`);
    const path = join(this.root, sceneFile(name));
    let text = formatSceneData(data);
    if ((await this.fs.read(path))?.includes("\r\n")) text = text.replace(/\n/g, "\r\n");
    await this.fs.write(path, text);
  }

  /** Deletes a scene's file; nothing happens when there is none. */
  async remove(name: string): Promise<void> {
    if (!isSceneName(name)) throw new Error(`"${name}" is not a valid scene name`);
    await this.fs.remove(join(this.root, sceneFile(name)));
  }
}

/**
 * The scenes API the scene editor talks to:
 *   GET    /          -> { version: 1, scenes: [{ name, text }] }
 *   PUT    /<name>    { data: SceneData }
 *   DELETE /<name>
 */
export function handleScenesRequest(
  files: SceneFiles,
  request: ApiRequest,
): Promise<ApiResponse> {
  return respond(async () => {
    const path = request.path.replace(/\/$/, "");
    if (path === "" && request.method === "GET") {
      return { status: 200, body: { version: 1, scenes: await files.list() } };
    }
    const scene = /^\/([^/]+)$/.exec(path);
    if (scene && (request.method === "PUT" || request.method === "DELETE")) {
      const name = scene[1];
      if (!isSceneName(name)) throw new ApiError(400, `"${name}" is not a valid scene name`);
      if (request.method === "DELETE") {
        await files.remove(name);
        return { status: 200, body: { ok: true } };
      }
      let data: SceneData;
      try {
        data = validateSceneShape(parseBody(request.body).data);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        throw new ApiError(400, `"data" must be scene data: ${reason}`);
      }
      await files.write(name, data);
      return { status: 200, body: { ok: true } };
    }
    throw new ApiError(404, `No such route: ${request.method} ${request.path}`);
  });
}
