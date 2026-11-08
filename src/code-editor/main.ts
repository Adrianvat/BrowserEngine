import { onFilesChanged } from "../dev-api/changes";
import { projectApiBase } from "../dev-api/projects";
import { ScriptsApi } from "../dev-api/scripts";
import {
  blobUrlHost,
  ComponentRegistry,
  loadScripts,
  parseScriptPath,
  scriptPath,
  type Script,
} from "../engine";
import { currentProject } from "../project/current";
import { scriptApi, scriptLoadOptions } from "../project/scripts";
import { ScriptLibrary } from "./library";
import { CodeEditorModel } from "./model";
import { Suggester } from "./suggest";
import { mountDetails } from "./views/details";
import { mountEditor } from "./views/editor";
import { mountHelp } from "./views/help";
import { mountMigration } from "./views/migration";
import { mountNavigator } from "./views/navigator";
import { mountTopBar } from "./views/top-bar";

function element<T extends HTMLElement>(selector: string, type: new () => T): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Code editor element not found: ${selector}`);
  return found;
}

// /code-editor.html?project=demo edits that project's scripts; without it, the one
// last picked in the scene editor, or else the first project's.
const current = await currentProject().catch((error: unknown) => {
  document.body.textContent = messageOf(error);
  throw error;
});
if (current === null) {
  document.body.textContent = "There are no projects; make one in the scene editor (/editor.html).";
  throw new Error("No projects");
}
const { id: projectId, settings } = current;

/** The scripts bundled with the page, for when there is no dev server to read files from. */
async function bundledScripts(): Promise<readonly Script[]> {
  return (await import("../project/bundle")).bundledProjects[projectId]?.scripts ?? [];
}
// Even imported lazily, the bundle counts as a dependency for Vite: without accepting its
// hot updates here, every saved file would reload this whole page (and lose the open
// script and the drafts). Nothing to do in the callback: the files are re-read when the
// dev server says they changed (below).
import.meta.hot?.accept("../project/bundle", () => {});

const sceneNames = settings.scenes;
// The built-in components, which a script can't be named after.
const fixedComponents = new ComponentRegistry().all();
const library = new ScriptLibrary({
  // The project's files, through the dev server (tools/game-files-plugin.ts).
  files: new ScriptsApi(projectApiBase(projectId, "scripts")),
  fallback: bundledScripts,
  reservedComponentNames: fixedComponents.map((c) => c.name),
  sceneNames,
});
await library.load();
const model = new CodeEditorModel({
  library,
  sceneNames,
  // Checking is loading: the same call the game page makes at start.
  checker: (scripts) => loadScripts(scripts, scriptLoadOptions(blobUrlHost(), settings)),
});
// Suggestions know the engine's classes and, by name, the components' editable fields.
const suggester = new Suggester(
  scriptApi,
  Object.fromEntries(fixedComponents.map((c) => [c.name, Object.keys(c.fields)])),
);

mountTopBar(element("#topbar", HTMLElement), model, library, {
  projectId,
  projectName: settings.name || projectId,
});
mountNavigator(element("#navigator", HTMLElement), model, library);
mountEditor(element("#editor", HTMLElement), model, { suggester });
mountDetails(element("#details", HTMLElement), model, library, projectId);
mountHelp(element("#help", HTMLElement), Object.keys(scriptApi), sceneNames);
mountMigration(element("#migration", HTMLElement), library, localStorageOrNull());

// Files changed on disk (by this editor, another tab, or another program) show up here.
onFilesChanged(projectId, "scripts", () => void library.reload());

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void model.save();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (model.dirty) event.preventDefault();
});

// /code-editor.html?script=systems/kick opens that script; the URL follows the open
// script, so a reload (or a bookmark) comes back to it.
const requested = new URLSearchParams(location.search).get("script");
const match = requested === null ? null : parseScriptPath(requested);
if (match && library.has(match.kind, match.name)) model.select(match);
else if (!match) {
  const first = library.scripts.find((script) => script.kind === "system") ?? library.scripts[0];
  if (first) model.select({ kind: first.kind, name: first.name });
}
model.onChange(() => {
  const url = new URL(location.href);
  const { selected } = model;
  if (selected) url.searchParams.set("script", scriptPath(selected.kind, selected.name));
  else url.searchParams.delete("script");
  if (url.href !== location.href) history.replaceState(null, "", url);
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function localStorageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
