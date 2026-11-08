import { pageUrl } from "../../project/page";
import { workspaceForFile } from "../open-image";
import { MAX_SIZE } from "../pixels";
import { savedMessage } from "../save";
import { READ_ONLY, type SpriteLibrary } from "../sprite-library";
import { STYLES, type EditorShell, type Style } from "../workspace";
import { createAsker } from "./ask";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function labelled(text: string, ...children: (HTMLElement | string)[]): HTMLLabelElement {
  const label = document.createElement("label");
  label.append(text, ...children);
  return label;
}

function numberInput(title: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = String(MAX_SIZE);
  input.title = title;
  return input;
}

export interface TopBar {
  /** Opens an image by name, e.g. the one in the page's URL. */
  open(name: string): Promise<void>;
  /** Re-reads the list of images that can be opened. */
  refresh(): Promise<void>;
  /** Shows a message in the status line. */
  report(text: string, kind?: "" | "error" | "saved"): void;
}

export interface TopBarOptions {
  /** The project the page is on: its id for links, its name to show. */
  projectId: string | null;
  projectName: string;
}

/** The project, name, style, size, New, Open, Save, the status line, and a way back to the scene editor. */
export function mountTopBar(
  root: HTMLElement,
  shell: EditorShell,
  library: SpriteLibrary,
  { projectId, projectName }: TopBarOptions = { projectId: null, projectName: "" },
): TopBar {
  const doc = () => shell.workspace.doc;
  // Questions show inline in the bar; browser dialogs can be suppressed (see createAsker).
  const { element: question, ask } = createAsker();

  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "sprite name";
  name.title = "The image's name in the scene editor";
  name.addEventListener("input", () => doc().setName(name.value));

  const style = document.createElement("select");
  style.title = "How the sprite is drawn: pixels, or shapes saved as SVG";
  for (const entry of STYLES) style.append(new Option(entry.label, entry.style));
  style.addEventListener("change", async () => {
    const next = style.value as Style;
    const { workspace } = shell;
    if (
      next !== workspace.style &&
      workspace.lossyToConvert &&
      !(await ask(
        "Converting to pixel art paints the shapes into pixels; they can't be edited as shapes afterwards.",
        "Convert",
      ))
    ) {
      style.value = shell.workspace.style;
      return;
    }
    // The workspace may have changed while the question was open (e.g. another image opened).
    if (shell.workspace !== workspace || next === workspace.style) {
      style.value = shell.workspace.style;
      return;
    }
    try {
      shell.switchStyle(next);
      report(next === "vector" ? "Now editing shapes; the sprite saves as an SVG" : "Now editing pixels; the sprite saves as a PNG");
    } catch (error) {
      report(`Couldn't convert: ${messageOf(error)}`, "error");
      style.value = workspace.style;
    }
  });

  const width = numberInput("Frame width in pixels (every frame has the same size)");
  const height = numberInput("Frame height in pixels (every frame has the same size)");
  const resize = () => {
    try {
      doc().resize(width.valueAsNumber, height.valueAsNumber);
      report("");
    } catch (error) {
      report(messageOf(error), "error");
      update();
    }
  };
  width.addEventListener("change", resize);
  height.addEventListener("change", resize);

  const fresh = document.createElement("button");
  fresh.textContent = "New";
  fresh.title = "Start a blank, single-frame sprite of this size";
  fresh.addEventListener("click", async () => {
    if (!(await discardOk())) return;
    shell.workspace.reset(doc().width, doc().height);
    report("");
  });

  const open = document.createElement("select");
  open.title = "Open an image to edit";
  open.addEventListener("change", () => {
    const chosen = open.value;
    open.value = "";
    if (chosen !== "") void openImage(chosen);
  });

  const save = document.createElement("button");
  save.textContent = "Save";
  save.title = "Save to the project's image files (Ctrl+S)";
  save.addEventListener("click", () => void saveSprite());

  const editor = document.createElement("button");
  editor.textContent = "Scene editor";
  editor.addEventListener("click", () => window.open(pageUrl("/editor.html", projectId), "_blank"));

  const project = document.createElement("span");
  project.className = "project";
  project.textContent = projectName === "" ? "" : `Project: ${projectName}`;
  project.title = "Which project's images this page edits; pick another in the scene editor";

  const status = document.createElement("span");
  status.className = "status";

  root.replaceChildren(
    project,
    labelled("Name ", name),
    labelled("Style ", style),
    labelled("Size ", width, "×", height),
    fresh,
    labelled("Open ", open),
    save,
    editor,
    question,
    status,
  );

  const report = (text: string, kind: "" | "error" | "saved" = "") => {
    status.textContent = text;
    status.className = `status ${kind}`.trim();
  };

  /** True when there is nothing to lose, or the user agrees to lose it. */
  const discardOk = async () =>
    !doc().dirty || (await ask("The sprite has unsaved changes. Discard them?", "Discard"));

  const refresh = async () => {
    const names = await library.list();
    open.replaceChildren(new Option("Open…", ""));
    for (const entry of names) open.append(new Option(entry, entry));
    open.value = "";
    // Whether the files can be written is known once they have been listed.
    update();
    if (!library.available) report(READ_ONLY, "error");
  };

  const openImage = async (chosen: string) => {
    if (!(await discardOk())) return;
    try {
      const { file, sheet } = await library.load(chosen);
      const { workspace, notes } = await workspaceForFile(file, chosen, chosen, sheet);
      shell.use(workspace);
      const how = `as ${workspace.label === "vector" ? "vector shapes" : "pixel art"}`;
      const about = `Opened "${chosen}" ${how}; saving replaces it`;
      report(notes.length > 0 ? `${about}. Not read: ${notes.join("; ")}` : about);
    } catch (error) {
      report(`Couldn't open "${chosen}": ${messageOf(error)}`, "error");
    }
  };

  let saving = false;
  const saveSprite = async () => {
    if (saving || !library.available) return;
    saving = true;
    save.disabled = true;
    try {
      const { workspace } = shell;
      const plan = await library.plan(workspace.doc.name);
      if (
        plan.replaces &&
        plan.name !== workspace.doc.openedFrom &&
        !(await ask(`Replace the existing image "${plan.name}"?`, "Replace"))
      ) {
        return;
      }
      const { file, sheet } = await workspace.export();
      await library.save(plan, file, sheet);
      workspace.doc.saved(plan.name);
      report(savedMessage(plan, workspace.doc.frameCount, Object.keys(workspace.doc.clips).length, workspace.label), "saved");
      await refresh();
    } catch (error) {
      report(`Couldn't save: ${messageOf(error)}`, "error");
    } finally {
      saving = false;
      save.disabled = !library.available;
    }
  };

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveSprite();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!doc().dirty) return;
    event.preventDefault();
    // Older browsers need this to ask before leaving.
    event.returnValue = "";
  });

  const update = (force = false) => {
    const current = doc();
    if (force || name !== document.activeElement) name.value = current.name;
    style.value = shell.workspace.style;
    if (width !== document.activeElement) width.value = String(current.width);
    if (height !== document.activeElement) height.value = String(current.height);
    save.disabled = saving || !library.available;
    save.title = library.available ? "Save to the project's image files (Ctrl+S)" : READ_ONLY;
    document.title = `${current.dirty ? "* " : ""}${current.name || "Untitled"} – Sprite Editor`;
  };
  const follow = () => {
    doc().onChange(() => update());
    // A new document: show its values even in a field the user was typing in.
    update(true);
  };
  shell.onChange(follow);
  follow();
  void refresh();

  return { open: openImage, refresh, report };
}
