import { ProjectsApi, type ProjectsClient } from "../dev-api/projects";
import { parseProjectSettings, PROJECT_FILE, type ProjectFile, type ProjectSettings } from "../engine";
import { resolveProjectId } from "./page";

/** The project a page is on. */
export interface CurrentProject {
  id: string;
  settings: ProjectSettings;
  /** True when the files came from the bundle, not the dev server: nothing can be written. */
  readOnly: boolean;
}

// Even imported lazily, the bundle counts as a dependency for Vite: without accepting its
// hot updates here, every saved project file would reload every page using this module.
// Nothing to do in the callback: pages read the files again when the dev server says
// they changed.
import.meta.hot?.accept("./bundle", () => {});

/** The projects' settings files from the dev server, or else the ones bundled with the page. */
export async function readProjectFiles(
  client: ProjectsClient = new ProjectsApi(),
): Promise<{ files: ProjectFile[]; readOnly: boolean }> {
  try {
    return { files: await client.load(), readOnly: false };
  } catch {
    const { bundledProjects } = await import("./bundle");
    const files = Object.values(bundledProjects).map(({ id, settingsText }) => ({ id, text: settingsText }));
    return { files, readOnly: true };
  }
}

/** A project's settings from its file, with an error that names the file. */
export function settingsOf(file: ProjectFile): ProjectSettings {
  try {
    return parseProjectSettings(file.text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`projects/${file.id}/${PROJECT_FILE}: ${reason}`);
  }
}

/**
 * The project this page is on (the URL's `project`, or else the one last picked in the
 * scene editor, or else the first one) and its settings. Null when there are no
 * projects; throws when the URL names a project that does not exist, or whose settings
 * can't be read.
 */
export async function currentProject(
  search = location.search,
  client?: ProjectsClient,
): Promise<CurrentProject | null> {
  const { files, readOnly } = await readProjectFiles(client);
  const ids = files.map((file) => file.id);
  const id = resolveProjectId(search, ids);
  if (id === null) return null;
  const file = files.find((candidate) => candidate.id === id);
  if (!file) throw new Error(`There is no project "${id}" (the projects are ${ids.join(", ") || "none"})`);
  return { id, settings: settingsOf(file), readOnly };
}
