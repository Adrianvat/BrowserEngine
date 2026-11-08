import {
  arrangeScripts,
  collectImageFiles,
  collectSceneFiles,
  parseScriptOrder,
  projectFromPath,
  type ImageFile,
  type SceneFile,
  type Script,
  type ScriptOrder,
} from "../engine";

/** One project as bundled with the pages: its files' text, and its images' URLs. */
export interface BundledProject {
  id: string;
  /** The text of project.json. */
  settingsText: string;
  scripts: Script[];
  sceneFiles: SceneFile[];
  imageFiles: ImageFile[];
}

/** What the globs over the projects folder give: each file's path, with its text or URL. */
export interface ProjectGlobs {
  /** projects/<id>/project.json -> text */
  settings: Record<string, string>;
  /** projects/<id>/scripts/<kind>s/<name>.js -> code */
  scripts: Record<string, string>;
  /** projects/<id>/scripts/order.json -> text */
  orders: Record<string, string>;
  /** projects/<id>/scenes/<name>.json -> text */
  scenes: Record<string, string>;
  /** projects/<id>/images/<name>.<ext> -> URL */
  images: Record<string, string>;
  /** projects/<id>/images/<name>.json -> text */
  sheets: Record<string, string>;
}

/** Splits a glob's entries by project, keeping the path inside the project. */
function byProject(entries: Record<string, string>): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();
  for (const [path, value] of Object.entries(entries)) {
    const found = projectFromPath(path);
    if (!found) continue;
    (result.get(found.id) ?? result.set(found.id, {}).get(found.id)!)[found.file] = value;
  }
  return result;
}

/** The projects (those with a project.json) the globs hold, by id. */
export function collectProjects(globs: ProjectGlobs): Record<string, BundledProject> {
  const settings = byProject(globs.settings);
  const scripts = byProject(globs.scripts);
  const orders = byProject(globs.orders);
  const scenes = byProject(globs.scenes);
  const images = byProject(globs.images);
  const sheets = byProject(globs.sheets);
  const projects: Record<string, BundledProject> = {};
  for (const id of [...settings.keys()].sort()) {
    const settingsText = settings.get(id)!["project.json"];
    if (settingsText === undefined) continue;
    let order: ScriptOrder;
    try {
      order = parseScriptOrder(JSON.parse(orders.get(id)?.["scripts/order.json"] ?? "{}"));
    } catch {
      order = { systems: [], disabled: [] };
    }
    projects[id] = {
      id,
      settingsText,
      scripts: arrangeScripts(scripts.get(id) ?? {}, order),
      sceneFiles: collectSceneFiles(scenes.get(id) ?? {}),
      imageFiles: collectImageFiles(images.get(id) ?? {}, sheets.get(id) ?? {}),
    };
  }
  return projects;
}
