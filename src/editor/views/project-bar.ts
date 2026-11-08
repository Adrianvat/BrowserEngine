import { confirmingButton } from "../../code-editor/views/confirm";
import { projectIdFromName } from "../../project/page";
import { READ_ONLY, type ProjectLibrary } from "../project-library";

export interface ProjectBarOptions {
  /** The project the page is on, or null when there is none. */
  currentId: string | null;
  /** Goes to the page for a project (null: for no project in particular). */
  navigate: (projectId: string | null) => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The project picker, New project (an inline form: the name, and the folder it makes)
 * and Delete project (asked inline first). Changing projects goes to this page for the
 * other project: everything on it belongs to one project.
 */
export function mountProjectBar(root: HTMLElement, library: ProjectLibrary, options: ProjectBarOptions): void {
  const { currentId, navigate } = options;
  let adding = false;
  let message = "";

  const label = document.createElement("span");
  label.textContent = "Project";

  const picker = document.createElement("select");
  picker.title = "The project this page edits";
  picker.addEventListener("change", () => {
    if (picker.value !== "" && picker.value !== currentId) navigate(picker.value);
  });

  const add = document.createElement("button");
  add.textContent = "New project";
  add.addEventListener("click", () => {
    adding = true;
    update();
    input.value = "";
    input.focus();
  });

  const form = document.createElement("form");
  form.className = "add-form";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "project name, e.g. My Game";
  input.setAttribute("aria-label", "Name of the new project");
  input.autocomplete = "off";
  const folder = document.createElement("span");
  folder.className = "muted";
  const problem = document.createElement("span");
  problem.className = "error";
  const create = document.createElement("button");
  create.type = "submit";
  create.textContent = "Create";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  form.append(input, folder, create, cancel, problem);

  const idOf = () => projectIdFromName(input.value);
  input.addEventListener("input", () => {
    const id = idOf();
    folder.textContent = id === "" ? "" : `projects/${id}`;
    problem.textContent = id === "" ? "" : (library.idProblem(id) ?? "");
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  cancel.addEventListener("click", close);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = input.value.trim();
    const id = idOf();
    const reason = id === "" ? "Give the project a name (letters and numbers)" : library.idProblem(id);
    if (reason !== null) {
      problem.textContent = reason;
      input.focus();
      return;
    }
    create.disabled = true;
    library.create(id, name).then(
      () => navigate(id),
      (error: unknown) => {
        create.disabled = false;
        problem.textContent = `Couldn't create the project: ${messageOf(error)}`;
      },
    );
  });

  const status = document.createElement("span");
  status.className = "status";

  function close(): void {
    adding = false;
    update();
  }

  const update = () => {
    picker.replaceChildren();
    for (const entry of library.entries) {
      const text = entry.error ? `${entry.name} (can't be read)` : entry.name;
      picker.append(new Option(text, entry.id));
    }
    if (currentId === null || !library.get(currentId)) {
      picker.append(new Option(library.entries.length === 0 ? "(no projects)" : "(pick a project)", ""));
    }
    picker.value = currentId ?? "";
    add.disabled = !library.available;
    const remove =
      currentId !== null && library.get(currentId)
        ? confirmingButton(
            "Delete project",
            `Delete the project "${library.get(currentId)!.name}" and all its files?`,
            () => {
              library.remove(currentId).then(
                () => navigate(null),
                (error: unknown) => report(`Couldn't delete the project: ${messageOf(error)}`),
              );
            },
            "danger",
          )
        : null;
    if (remove && !library.available) remove.querySelector("button")!.disabled = true;
    const text = library.loadError ? `The projects can't be read: ${library.loadError}` : library.available ? message : READ_ONLY;
    status.textContent = text;
    status.classList.toggle("error", library.loadError !== null || message !== "");
    root.replaceChildren(label, picker, adding ? form : add, ...(remove ? [remove] : []), status);
  };
  const report = (text: string) => {
    message = text;
    update();
  };

  library.onChange(update);
  update();
}
