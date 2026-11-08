import { isSceneName, type SceneData, type SceneFile } from "../engine";
import { callApi, type ApiOptions } from "./call";

/** Where scenes are kept: the project's files, through the dev server's API. */
export interface SceneFilesClient {
  /** Every scene file. Throws when the files can't be reached (no dev server, say). */
  load(): Promise<SceneFile[]>;
  write(name: string, data: SceneData): Promise<void>;
  /** Deletes a scene's file; nothing happens when there is none. */
  remove(name: string): Promise<void>;
}

function isSceneFile(value: unknown): value is SceneFile {
  if (typeof value !== "object" || value === null) return false;
  const { name, text } = value as Record<string, unknown>;
  return typeof name === "string" && isSceneName(name) && typeof text === "string";
}

/** Checks the server's answer to GET /api/scenes and returns its scene files. */
export function validateSceneFiles(value: unknown): SceneFile[] {
  const { version, scenes } = (value ?? {}) as { version?: unknown; scenes?: unknown };
  if (version !== 1 || !Array.isArray(scenes) || !scenes.every(isSceneFile)) {
    throw new Error("The scenes API answered with something other than scene files");
  }
  return scenes.map(({ name, text }) => ({ name, text }));
}

/** The dev server's /api/scenes (see tools/scene-files.ts for the routes). */
export class ScenesApi implements SceneFilesClient {
  private readonly options: ApiOptions;

  constructor(base = "/api/scenes", fetchFn?: typeof fetch) {
    this.options = { base, fetchFn };
  }

  async load(): Promise<SceneFile[]> {
    return validateSceneFiles(await callApi(this.options, "GET", ""));
  }

  async write(name: string, data: SceneData): Promise<void> {
    await callApi(this.options, "PUT", `/${name}`, { data });
  }

  async remove(name: string): Promise<void> {
    await callApi(this.options, "DELETE", `/${name}`);
  }
}
