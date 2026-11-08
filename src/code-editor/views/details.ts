import { scriptFile, scriptPath, type FieldKind } from "../../engine";
import type { ScriptLibrary } from "../library";
import type { CheckInfo, CodeEditorModel } from "../model";
import { confirmingButton } from "./confirm";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function button(text: string, onClick: () => void, title = ""): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = text;
  element.title = title;
  element.addEventListener("click", onClick);
  return element;
}

function describeField(kind: FieldKind): string {
  return typeof kind === "object" ? `one of ${kind.choice.join(" | ")}` : kind;
}

interface CheckLine {
  text: string;
  kind: "" | "ok" | "error";
}

/** What the last check says about the open script. */
function checkLine(info: CheckInfo | null, checking: boolean): CheckLine {
  if (info === null) return { text: checking ? "Checking…" : "Not checked yet", kind: "" };
  if (info.error) return { text: info.error, kind: "error" };
  if (info.system) {
    const { scenes, phase } = info.system;
    const where =
      scenes === null ? "every scene" : scenes.length === 0 ? "no scene" : scenes.join(", ");
    const when = phase === "render" ? "once per frame after rendering" : "at each 60 Hz step";
    const start = info.system.startsEnabled ? "" : " Starts switched off, until a script enables it.";
    const hooks = [info.system.onEnable && "onEnable", info.system.onDisable && "onDisable"].filter(Boolean);
    const withHooks = hooks.length === 0 ? "" : ` With ${hooks.join(" and ")}.`;
    return { text: `✓ Loads. Runs in ${where}, ${when}.${start}${withHooks}`, kind: "ok" };
  }
  if (info.scene) return { text: `✓ Loads. Sets up the "${info.scene.name}" scene.`, kind: "ok" };
  if (info.component) {
    const fields = Object.entries(info.component.definition.fields);
    const list = fields.map(([name, kind]) => `${name} (${describeField(kind)})`).join(", ");
    const with_ = fields.length === 0 ? "no editable fields (a tag)" : `fields: ${list}`;
    return { text: `✓ Loads, with ${with_}.`, kind: "ok" };
  }
  return { text: "Not loaded (another script it needs failed?)", kind: "error" };
}

/** The open script: its file, Save/Discard, Move, Remove, and the check result. */
export function mountDetails(
  root: HTMLElement,
  model: CodeEditorModel,
  library: ScriptLibrary,
  /** The project whose scripts these are, for the file paths shown. */
  projectId = "",
): void {
  const note = document.createElement("p");
  note.className = "error note";
  const report = (text: string) => {
    note.textContent = text;
  };
  /** Runs an action, reporting a failure whether it throws at once or later. */
  const attempt = (action: () => void | Promise<void>) => {
    try {
      report("");
      const result = action();
      if (result) result.catch((error: unknown) => report(messageOf(error)));
    } catch (error) {
      report(messageOf(error));
    }
  };

  const update = () => {
    root.replaceChildren(note);
    const { selected } = model;
    if (!selected) return;
    const { kind, name } = selected;
    if (!library.has(kind, name)) return;

    const title = document.createElement("h2");
    title.textContent = scriptPath(kind, name);
    const dirty = model.isDirty(kind, name);
    const about = document.createElement("p");
    about.className = "muted";
    about.textContent = library.readOnly
      ? `The file ${scriptFile(kind, name)}; read-only without the dev server.`
      : `The file projects/${projectId}/scripts/${scriptFile(kind, name)}.`;
    if (library.get(kind, name)?.disabled) about.textContent += " Disabled: the game does not run it.";

    const actions = document.createElement("div");
    actions.className = "actions";
    const save = button("Save", () => attempt(() => model.save()), "Save every unsaved script (Ctrl+S)");
    save.disabled = !dirty;
    const discard = button("Discard changes", () => attempt(() => model.discard()), "Back to the saved text");
    discard.disabled = !dirty;
    actions.append(save, discard);

    const arrange = document.createElement("div");
    arrange.className = "actions";
    const order = kind === "system" ? "Systems run in list order. " : "";
    const up = () => attempt(() => model.move(kind, name, -1));
    const down = () => attempt(() => model.move(kind, name, 1));
    arrange.append(
      button("↑ Move up", up, `${order}Move this ${kind} up`),
      button("↓ Move down", down, `${order}Move this ${kind} down`),
    );
    if (kind === "system") {
      const off = library.get(kind, name)?.disabled === true;
      const toggle = button(
        off ? "Enable" : "Disable",
        () => attempt(() => model.setEnabled(name, off)),
        off
          ? "Run this system again"
          : "Take this system out of the game without deleting its file; it can be enabled again later",
      );
      arrange.append(toggle);
    }
    const warning =
      kind === "component" ? " Scenes whose entities use it won't load until it is back." : "";
    arrange.append(
      confirmingButton(
        "Remove",
        `Delete the ${kind} "${name}" and its file?${warning}`,
        () => attempt(() => model.remove(kind, name)),
        "danger",
      ),
    );


    const checkTitle = document.createElement("h3");
    checkTitle.textContent = dirty ? "Check (of the unsaved text)" : "Check";
    const check = document.createElement("pre");
    const line = model.checkError
      ? { text: `Couldn't check the scripts: ${model.checkError}`, kind: "error" }
      : checkLine(model.infoOf(kind, name), model.checking);
    check.className = `check ${line.kind}`;
    check.textContent = line.text;

    root.append(title, about);
    if (!library.readOnly) root.append(actions, arrange);
    root.append(checkTitle, check);
  };
  model.onChange(update);
  update();
}
