import { confirmingButton } from "../../code-editor/views/confirm";
import { pageUrl } from "../../project/page";
import type { EditorModel, SaveStatus } from "../model";

function statusText(status: SaveStatus, projectId: string): string {
  if (status === "readOnly") return "Read-only: the dev server (npm run dev) is needed to save";
  if (typeof status === "object") return `Not saved: ${status.error}`;
  if (status === "saving") return "Saving…";
  return `Saved to projects/${projectId}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The scenes of the project: the picker, Add scene (an inline form), Remove scene (asked
 * inline first) and Start here; the other pages (Play, perf, sprite and code editors)
 * for this project; and the save status.
 */
export function mountTopBar(root: HTMLElement, model: EditorModel, projectId: string): void {
  let adding = false;
  let message = "";

  const sceneLabel = document.createElement("span");
  sceneLabel.textContent = "Scene";
  const scenes = document.createElement("select");
  scenes.title = "The scene being edited";
  scenes.addEventListener("change", () => model.openScene(scenes.value));

  const add = document.createElement("button");
  add.textContent = "+ Add scene";
  add.addEventListener("click", () => {
    adding = true;
    update();
    input.value = "";
    problem.textContent = "";
    input.focus();
  });

  const form = document.createElement("form");
  form.className = "add-form";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "scene name, e.g. level1";
  input.setAttribute("aria-label", "Name of the new scene");
  input.autocomplete = "off";
  input.spellcheck = false;
  const problem = document.createElement("span");
  problem.className = "error";
  const create = document.createElement("button");
  create.type = "submit";
  create.textContent = "Add";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  form.append(input, create, cancel, problem);
  const close = () => {
    adding = false;
    update();
  };
  input.addEventListener("input", () => {
    const name = input.value.trim();
    problem.textContent = name === "" ? "" : (model.sceneNameProblem(name) ?? "");
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  cancel.addEventListener("click", close);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = input.value.trim();
    const reason = model.sceneNameProblem(name);
    if (reason !== null) {
      problem.textContent = reason;
      input.focus();
      return;
    }
    try {
      adding = false;
      model.addScene(name);
      report("");
    } catch (error) {
      report(messageOf(error));
    }
  });

  const start = document.createElement("button");
  start.textContent = "Start here";
  start.title = "Make this the scene the game starts in";
  start.addEventListener("click", () => attempt(() => model.setFirstScene(model.scene)));

  const play = document.createElement("button");
  play.textContent = "Play";
  play.title = "Open the game in a new tab; it reloads whenever a scene, image or script is saved";
  play.addEventListener("click", () => window.open(pageUrl("/", projectId), "_blank"));

  const perf = document.createElement("button");
  perf.textContent = "Perf logs";
  perf.addEventListener("click", () => window.open("/perf.html", "_blank"));

  const livePerf = document.createElement("button");
  livePerf.textContent = "Live perf";
  livePerf.addEventListener("click", () => window.open("/live-perf.html", "_blank"));

  const sprites = document.createElement("button");
  sprites.textContent = "Sprite editor";
  sprites.addEventListener("click", () => window.open(pageUrl("/sprite-editor.html", projectId), "_blank"));

  const code = document.createElement("button");
  code.textContent = "Code editor";
  code.addEventListener("click", () => window.open(pageUrl("/code-editor.html", projectId), "_blank"));

  const status = document.createElement("span");
  status.className = "status";

  const attempt = (action: () => void) => {
    try {
      action();
      report("");
    } catch (error) {
      report(messageOf(error));
    }
  };
  const report = (text: string) => {
    message = text;
    update();
  };

  const update = () => {
    scenes.replaceChildren();
    for (const name of model.sceneNames) {
      scenes.append(new Option(name === model.firstScene ? `${name} (start)` : name, name));
    }
    scenes.value = model.scene;
    const editable = !model.readOnly;
    add.disabled = !editable;
    start.disabled = !editable || model.scene === model.firstScene;
    const remove = confirmingButton(
      "Remove scene",
      `Remove the scene "${model.scene}" from the project and delete its file?`,
      () => attempt(() => model.removeScene(model.scene)),
      "danger",
    );
    if (!editable || model.sceneNames.length < 2) remove.querySelector("button")!.disabled = true;
    status.textContent = message !== "" ? message : statusText(model.status, projectId);
    status.classList.toggle("error", message !== "" || typeof model.status === "object");
    status.classList.toggle("muted", message === "" && model.status === "saved");
    root.replaceChildren(
      sceneLabel,
      scenes,
      adding ? form : add,
      remove,
      start,
      play,
      perf,
      livePerf,
      sprites,
      code,
      status,
    );
  };
  model.onChange(() => {
    message = "";
    update();
  });
  update();
}
