import { onFilesChanged } from "../dev-api/changes";
import { ImagesApi } from "../dev-api/images";
import { projectApiBase, ProjectsApi } from "../dev-api/projects";
import { ScenesApi } from "../dev-api/scenes";
import { ScriptsApi } from "../dev-api/scripts";
import {
  Assets,
  blobUrlHost,
  describeScriptErrors,
  imageFromFile,
  loadScripts,
  parseProjectSettings,
  sheetFromFile,
  type ComponentDefinition,
  type ProjectSettings,
  type Script,
} from "../engine";
import type { BundledProject } from "../project/collect";
import { pageUrl, rememberProjectId, resolveProjectId } from "../project/page";
import { scriptLoadOptions } from "../project/scripts";
import { ImageLibrary } from "./image-library";
import { browserLocalStorage, findLegacyContent } from "./legacy-storage";
import { EditorModel } from "./model";
import { ProjectLibrary } from "./project-library";
import { mountEntityList } from "./views/entity-list";
import { mountImageList } from "./views/image-list";
import { mountInspector } from "./views/inspector";
import { mountMigration } from "./views/migration";
import { mountProjectBar } from "./views/project-bar";
import { mountTopBar } from "./views/top-bar";
import { mountViewport } from "./views/viewport";

function element<T extends HTMLElement>(selector: string, type: new () => T): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Editor element not found: ${selector}`);
  return found;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const notice = element("#notice", HTMLElement);

// The projects, their scripts, scenes and images are files, read and written through the
// dev server (tools/game-files-plugin.ts). Without it (a production build) the copies
// bundled with the page are shown, read-only. The bundle is only loaded when it is
// needed: even imported lazily it counts as a dependency for Vite, so its hot updates
// are accepted here (nothing to do: the files are re-read when the dev server says they
// changed). Loading it can fail for a moment after a project was deleted, before Vite has
// noticed; then there is just no fallback.
import.meta.hot?.accept("../project/bundle", () => {});
async function bundled(): Promise<Record<string, BundledProject>> {
  return (await import("../project/bundle")).bundledProjects;
}

const projectsApi = new ProjectsApi();
const projects = new ProjectLibrary(projectsApi, async () =>
  Object.values(await bundled()).map(({ id, settingsText }) => ({ id, text: settingsText })),
);
await projects.load();

// /editor.html?project=demo edits that project; without it, the one last picked here
// (the other pages default to it too), or else the first project.
const projectId = resolveProjectId(location.search, projects.ids);
const navigate = (id: string | null) => {
  location.href = pageUrl("/editor.html", id);
};
mountProjectBar(element("#projects", HTMLElement), projects, { currentId: projectId, navigate });
// New or deleted projects (here or elsewhere) show up in the picker.
onFilesChanged(null, "settings", () => void projects.load());

const entry = projectId === null ? undefined : projects.get(projectId);
if (projectId === null) {
  notice.textContent =
    projects.entries.length === 0
      ? "There are no projects yet: make one with New project."
      : "Pick a project.";
} else if (!entry) {
  notice.textContent = `There is no project "${projectId}"; pick one.`;
} else if (!entry.settings) {
  notice.textContent = `The project can't be opened: ${entry.error}`;
} else {
  // This is now the project the other pages open when their own URL does not say.
  rememberProjectId(projectId);
  await openProject(projectId, entry.settings);
}

/** Puts the editor for one project on the page. */
async function openProject(projectId: string, settings: ProjectSettings): Promise<void> {
  /**
   * The components defined by the project's scripts (the files the code editor writes).
   * A broken script is reported in the sidebar; the other components still work.
   */
  async function readScriptComponents(scripts: readonly Script[]): Promise<ComponentDefinition[]> {
    try {
      const loaded = await loadScripts(scripts, scriptLoadOptions(blobUrlHost(), settings));
      const problems = loaded.errors.filter((error) => error.kind === "component");
      notice.textContent =
        problems.length === 0
          ? ""
          : "Some component scripts did not load (open the code editor to fix them):\n" +
            describeScriptErrors(problems);
      return loaded.components.map((component) => component.definition);
    } catch (error) {
      notice.textContent = `Scripts could not be read: ${messageOf(error)}`;
      return [];
    }
  }

  /** The project's scripts, from the dev server or else the bundle. */
  const scriptsApi = new ScriptsApi(projectApiBase(projectId, "scripts"));
  async function readScripts(): Promise<readonly Script[]> {
    try {
      return await scriptsApi.load();
    } catch {
      return (await bundled())[projectId]?.scripts ?? [];
    }
  }

  const components = await readScriptComponents(await readScripts());
  const assets = new Assets();
  const library = new ImageLibrary({
    files: new ImagesApi(projectApiBase(projectId, "images")),
    fallback: async () => (await bundled())[projectId]?.imageFiles ?? [],
    assets,
  });
  const model = new EditorModel({
    settings,
    components,
    files: new ScenesApi(projectApiBase(projectId, "scenes")),
    fallback: async () => (await bundled())[projectId]?.sceneFiles ?? [],
    writeSettings: (next) => projectsApi.writeSettings(projectId, next),
    listImages: () => library.names,
  });
  await model.load();
  try {
    await library.load();
  } catch (error) {
    notice.textContent = `Failed to load images: ${messageOf(error)}`;
  }
  library.onChange(() => model.imagesChanged());

  // Files changed on disk (saved in the code or sprite editor, another tab, or another
  // program) are re-read: scripts for their components, scenes and images as they are.
  onFilesChanged(projectId, "scripts", () => {
    void readScripts()
      .then(readScriptComponents)
      .then((next) => model.setComponents(next));
  });
  onFilesChanged(projectId, "scenes", () => void model.reload());
  // The settings changed by hand (another scene, a new size): this page is for the old
  // ones, so it starts over. Its own writes match what it holds and change nothing.
  onFilesChanged(projectId, "settings", () => {
    void projectsApi.load().then((files) => {
      const file = files.find((candidate) => candidate.id === projectId);
      if (!file) return;
      let next: ProjectSettings;
      try {
        next = parseProjectSettings(file.text);
      } catch {
        return;
      }
      if (JSON.stringify(next) !== JSON.stringify(model.settings)) location.reload();
    }, () => {});
  });
  onFilesChanged(projectId, "images", (changes) => {
    const names = changes.map((change) => imageFromFile(change.file)?.name ?? sheetFromFile(change.file));
    void library.reload(names.filter((name): name is string => name !== null));
  });

  mountTopBar(element("#topbar", HTMLElement), model, projectId);
  mountViewport(element("#viewport", HTMLCanvasElement), model, assets);
  mountEntityList(element("#entities", HTMLElement), model);
  mountImageList(element("#images", HTMLElement), library, model, assets, projectId);
  mountInspector(element("#inspector", HTMLElement), model);
  // Scenes and images an older version of the editor kept in this browser, offered for import.
  const migration = element("#migration", HTMLElement);
  void findLegacyContent(browserLocalStorage(), globalThis.indexedDB ?? null, model.sceneNames).then(
    (legacy) => mountMigration(migration, model, library, legacy),
    () => {},
  );

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Delete" || model.selected === null || model.loadError) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    model.removeEntity(model.selected);
  });
}
