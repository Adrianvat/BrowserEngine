import type { EditorModel, SaveStatus } from "../model";

function statusText(status: SaveStatus): string {
  if (status === "saved") return "Saved";
  if (status === "default") return "Default (not edited)";
  return `Not saved: ${status.error}`;
}

/** Scene picker, Play, Reset to default, and the save status. */
export function mountTopBar(root: HTMLElement, model: EditorModel): void {
  const scenes = document.createElement("select");
  for (const name of model.sceneNames) scenes.append(new Option(name, name));
  scenes.addEventListener("change", () => model.openScene(scenes.value));

  const play = document.createElement("button");
  play.textContent = "Play";
  play.addEventListener("click", () => window.open("/", "_blank"));

  const reset = document.createElement("button");
  reset.textContent = "Reset to default";
  reset.addEventListener("click", () => model.resetScene());

  const status = document.createElement("span");
  status.className = "status";

  root.replaceChildren(scenes, play, reset, status);

  const update = () => {
    scenes.value = model.scene;
    status.textContent = statusText(model.status);
    status.classList.toggle("error", typeof model.status === "object");
  };
  model.onChange(update);
  update();
}
