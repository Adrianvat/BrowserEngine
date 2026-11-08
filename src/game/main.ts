import {
  blobUrlHost,
  Canvas,
  describeScriptErrors,
  Game,
  loadScripts,
  parseProjectSettings,
  PROJECT_FILE,
  sceneFile,
  scenesFromScripts,
  toImageSources,
  withScriptSystems,
  type ProjectSettings,
  type SceneFile,
} from "../engine";
import { bundledProjects } from "../project/bundle";
import type { BundledProject } from "../project/collect";
import { resolveProjectId } from "../project/page";
import { scriptLoadOptions } from "../project/scripts";
import { drawError } from "./errors";

function canvasElement(): HTMLCanvasElement {
  const element = document.querySelector("#game");
  if (!(element instanceof HTMLCanvasElement)) throw new Error("Canvas #game not found");
  return element;
}

/** A scene file's contents; the game checks them against the components when it starts. */
function sceneDataOf(file: SceneFile): unknown {
  try {
    return JSON.parse(file.text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Scene "${file.name}" (${sceneFile(file.name)}) is not valid JSON: ${reason}`);
  }
}

/** The project this page plays: the URL's, or else the one last picked in the scene editor. */
function currentProject(projects: Record<string, BundledProject>): BundledProject {
  const ids = Object.keys(projects);
  const id = resolveProjectId(location.search, ids);
  if (id === null) throw new Error("There are no projects; make one in the scene editor (/editor.html)");
  const project = projects[id];
  if (!project) throw new Error(`There is no project "${id}" (the projects are ${ids.join(", ")})`);
  return project;
}

function settingsOf(project: BundledProject): ProjectSettings {
  try {
    return parseProjectSettings(project.settingsText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`projects/${project.id}/${PROJECT_FILE}: ${reason}`);
  }
}

// While developing, a changed script, scene or image file (e.g. saved in one of the
// editors) starts the game afresh. Accepting the update and reloading here, rather than
// leaving it to Vite, keeps the reload to this page: an unaccepted update makes Vite
// reload every open page, the editors included. Other projects' changes are ignored.
const projectId = (() => {
  try {
    return currentProject(bundledProjects).id;
  } catch {
    return null;
  }
})();
const snapshot = projectId === null ? "" : JSON.stringify(bundledProjects[projectId]);
import.meta.hot?.accept("../project/bundle", (updated) => {
  if (!updated) return;
  const { bundledProjects: next } = updated as unknown as { bundledProjects: Record<string, BundledProject> };
  const mine = projectId === null ? undefined : next[projectId];
  if (projectId === null || JSON.stringify(mine ?? "") !== snapshot) location.reload();
});

let game: Game | null = null;
let size = { width: 800, height: 600 };

try {
  const project = currentProject(bundledProjects);
  const settings = settingsOf(project);
  size = settings;
  document.title = settings.name || project.id;

  // The project's logic: the scripts in its scripts folder.
  const loaded = await loadScripts(project.scripts, scriptLoadOptions(blobUrlHost(), settings));
  if (loaded.errors.length > 0) {
    throw new Error(`Scripts failed to load:\n${describeScriptErrors(loaded.errors)}`);
  }

  game = new Game({
    canvas: canvasElement(),
    width: settings.width,
    height: settings.height,
    pixelArt: settings.pixelArt,
    components: loaded.components.map((c) => c.definition),
    gravity: settings.gravity,
    collisionLayers: settings.collisionLayers,
    // E.g. an Animator clip or sprite frame set in the editor that doesn't exist, or a
    // script system that throws.
    onError: (error) => {
      drawError(game!.canvas, error);
      console.error(error);
    },
  });

  await game.assets.loadImages(toImageSources(project.imageFiles));
  // Each scene's setup is its scene script (if any) plus the script systems that belong
  // to it; its entities are its file in the scenes folder (none: the scene starts empty).
  const scenes = withScriptSystems(scenesFromScripts(settings.scenes, loaded.scenes), loaded.systems);
  for (const [name, scene] of Object.entries(scenes)) {
    const file = project.sceneFiles.find((candidate) => candidate.name === name);
    game.addScene(name, scene, file && sceneDataOf(file));
  }
  if (settings.scenes.length === 0) throw new Error(`Project "${project.id}" has no scenes`);
  game.start(settings.firstScene);
} catch (error) {
  const canvas = game?.canvas ?? new Canvas(canvasElement(), size.width, size.height);
  drawError(canvas, error);
  throw error;
}
