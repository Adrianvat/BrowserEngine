import { pageUrl } from "../../project/page";
import type { SaveStatus, ScriptLibrary } from "../library";
import type { CodeEditorModel } from "../model";

export interface TopBarOptions {
  /** The project the page is on: its id for links, its name to show. */
  projectId: string | null;
  projectName: string;
}

function statusText(status: SaveStatus, dirty: boolean, loadError: string | null, projectId: string | null): string {
  if (loadError !== null) return `The scripts can't be read: ${loadError}`;
  if (status === "readOnly") return "Read-only: the dev server (npm run dev) is needed to save";
  if (typeof status === "object") return `Not saved: ${status.error}`;
  if (status === "saving") return "Saving…";
  if (dirty) return "Unsaved changes";
  return `Saved to projects/${projectId ?? ""}/scripts`;
}

/** The project, Save, Play, Scene editor, and the save/check status. */
export function mountTopBar(
  root: HTMLElement,
  model: CodeEditorModel,
  library: ScriptLibrary,
  { projectId, projectName }: TopBarOptions = { projectId: null, projectName: "" },
): void {
  const project = document.createElement("span");
  project.className = "project";
  project.textContent = projectName === "" ? "" : `Project: ${projectName}`;
  project.title = "Which project's scripts this page edits; pick another in the scene editor";

  const save = document.createElement("button");
  save.textContent = "Save";
  save.title = "Save every unsaved script (Ctrl+S)";
  save.addEventListener("click", () => void model.save());

  const play = document.createElement("button");
  play.textContent = "Play";
  play.title = "Open the game in a new tab; it reloads whenever scripts are saved";
  play.addEventListener("click", () => window.open(pageUrl("/", projectId), "_blank"));

  const scenes = document.createElement("button");
  scenes.textContent = "Scene editor";
  scenes.addEventListener("click", () => window.open(pageUrl("/editor.html", projectId), "_blank"));

  const status = document.createElement("span");
  status.className = "status";
  const checking = document.createElement("span");
  checking.className = "status muted";

  root.replaceChildren(project, save, play, scenes, status, checking);

  const update = () => {
    save.disabled = !model.dirty || library.readOnly;
    status.textContent = statusText(library.status, model.dirty, library.loadError, projectId);
    const bad = library.loadError !== null || typeof library.status === "object";
    status.classList.toggle("error", bad);
    status.classList.toggle("unsaved", !bad && model.dirty);
    checking.textContent = model.checking ? "Checking…" : "";
  };
  model.onChange(update);
  update();
}
