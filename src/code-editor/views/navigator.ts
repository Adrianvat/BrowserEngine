import { BUILT_IN_SYSTEMS, type BuiltInSystem, type Script, type ScriptKind } from "../../engine";
import type { ScriptLibrary } from "../library";
import type { CodeEditorModel } from "../model";

const KIND_TITLES: Record<ScriptKind, string> = { system: "Systems", component: "Components", scene: "Scene setups" };
const EXAMPLES: Record<ScriptKind, string> = { system: "bounce", component: "Spin", scene: "play" };

function tag(text: string, className = "tag"): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The inline form that asks for a new script's name. */
interface NameForm {
  form: HTMLFormElement;
  input: HTMLInputElement;
  problem: HTMLSpanElement;
  /** Puts the form back to its starting state, e.g. when it opens. */
  reset(): void;
}

/** The value of the systems picker's entry for a system of the project's own. */
const NEW_SYSTEM = "";
/** What precedes a disabled system's name in the picker's values, so it is told from a built-in. */
const ENABLE = "enable:";

/**
 * The systems (in the order they run), the components and the scene setups, each with
 * Add. An entry shows whether it has unsaved text, the scenes a system runs in, and a
 * mark when the last check found a problem with it. Adding asks for the name in an
 * inline form, not a browser dialog (which a browser can suppress); for systems the form
 * starts with a picker: a system of the project's own, one of the engine's built-in
 * systems (physics, say) added as a ready-made script, or a disabled system switched on
 * again. Systems that are not currently run — switched off, or one of the engine's that
 * was never added — are listed apart, under "Not running"; a built-in one there is a
 * single click away from running.
 */
export function mountNavigator(
  root: HTMLElement,
  model: CodeEditorModel,
  library: ScriptLibrary,
): void {
  const note = document.createElement("p");
  note.className = "error note";
  const report = (text: string) => {
    note.textContent = text;
  };

  /** The kind being added, while its name form is open. */
  let adding: ScriptKind | null = null;
  /** True right after the form opened, so the next render focuses its input. */
  let focusForm = false;

  const close = () => {
    adding = null;
    update();
  };

  const nameForm = (kind: ScriptKind): NameForm => {
    const form = document.createElement("form");
    form.className = "add-form";
    // Systems: which one, the project's own (named below) or one of the engine's.
    const picker = document.createElement("select");
    picker.setAttribute("aria-label", "Which system to add");
    const refreshPicker = () => {
      picker.replaceChildren(new Option("New system…", NEW_SYSTEM));
      for (const system of BUILT_IN_SYSTEMS) {
        const taken = library.has("system", system.name);
        const option = new Option(`${system.name} (${taken ? "already in the project" : "built in"})`, system.name);
        option.disabled = taken;
        option.title = system.description;
        picker.append(option);
      }
      for (const script of library.ofKind("system")) {
        if (!script.disabled) continue;
        const option = new Option(`${script.name} (disabled; enable it again)`, ENABLE + script.name);
        option.title = "Its file is still there; the game just doesn't run it";
        picker.append(option);
      }
      picker.value = NEW_SYSTEM;
    };
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = kind === "scene" ? `the scene's name, e.g. ${EXAMPLES[kind]}` : `${kind} name, e.g. ${EXAMPLES[kind]}`;
    input.setAttribute("aria-label", `Name of the new ${kind}`);
    input.autocomplete = "off";
    input.spellcheck = false;
    const problem = document.createElement("span");
    problem.className = "error";
    const add = document.createElement("button");
    add.type = "submit";
    add.textContent = "Add";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";

    input.addEventListener("input", () => {
      const name = input.value.trim();
      problem.textContent = name === "" ? "" : (library.nameProblem(kind, name) ?? "");
    });
    const escapes = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    input.addEventListener("keydown", escapes);
    picker.addEventListener("keydown", escapes);
    picker.addEventListener("change", () => {
      // A built-in system has its name already; only a system of the project's own needs one.
      input.hidden = picker.value !== NEW_SYSTEM;
      problem.textContent = "";
      if (!input.hidden) input.focus();
    });
    cancel.addEventListener("click", close);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const picked = kind === "system" && picker.value !== NEW_SYSTEM ? picker.value : null;
      if (picked !== null && picked.startsWith(ENABLE)) {
        const name = picked.slice(ENABLE.length);
        adding = null;
        report("");
        try {
          model.setEnabled(name, true).catch((error: unknown) => report(messageOf(error)));
          model.select({ kind: "system", name });
        } catch (error) {
          report(messageOf(error));
        }
        return;
      }
      const name = picked ?? input.value.trim();
      const reason = library.nameProblem(kind, name);
      if (reason !== null) {
        problem.textContent = reason;
        if (picked === null) input.focus();
        return;
      }
      try {
        adding = null;
        report("");
        const added = picked === null ? model.add(kind, name) : model.addBuiltInSystem(picked);
        added.catch((error: unknown) => report(messageOf(error)));
      } catch (error) {
        report(messageOf(error));
      }
    });
    if (kind === "system") form.append(picker);
    form.append(input, add, cancel, problem);
    const reset = () => {
      if (kind === "system") refreshPicker();
      input.hidden = false;
      input.value = "";
      problem.textContent = "";
    };
    reset();
    return { form, input, problem, reset };
  };
  const forms: Record<ScriptKind, NameForm> = {
    system: nameForm("system"),
    component: nameForm("component"),
    scene: nameForm("scene"),
  };

  const open = (kind: ScriptKind) => {
    adding = kind;
    focusForm = true;
    forms[kind].reset();
    update();
  };

  const section = (kind: ScriptKind): HTMLElement[] => {
    const title = document.createElement("h2");
    title.textContent = KIND_TITLES[kind];

    const button = document.createElement("button");
    button.textContent = kind === "scene" ? "+ Add scene setup" : `+ Add ${kind}`;
    button.disabled = library.loadError !== null || library.readOnly;
    button.addEventListener("click", () => open(kind));

    const scripts = library.ofKind(kind);
    const list = document.createElement("ul");
    for (const script of scripts) if (!script.disabled) list.append(item(script));
    if (list.childElementCount === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = kind === "scene" ? "No scene setups" : `No ${kind}s`;
      list.append(empty);
    }
    const parts = [title, adding === kind ? forms[kind].form : button, list];
    // Systems switched off keep their file but are not run, and neither are the engine's
    // built-in systems the project never added: both sit apart, so the list above is
    // only what actually runs; clicking a built-in one adds it, switched on.
    const off = scripts.filter((script) => script.disabled);
    const missingBuiltIns = kind === "system" ? BUILT_IN_SYSTEMS.filter((s) => !library.has("system", s.name)) : [];
    if (off.length > 0 || missingBuiltIns.length > 0) {
      const offTitle = document.createElement("h3");
      offTitle.className = "muted";
      offTitle.textContent = "Not running";
      offTitle.title =
        "Systems switched off (their files are kept; enable one from its details or the Add system " +
        "form) and the engine's built-in systems not added to the project yet (click one to add it, switched on).";
      const offList = document.createElement("ul");
      offList.className = "disabled";
      for (const script of off) offList.append(item(script));
      for (const system of missingBuiltIns) offList.append(builtInItem(system));
      parts.push(offTitle, offList);
    }
    return parts;
  };

  /** A built-in system the project has not added: clicking adds it, switched on. */
  const builtInItem = (system: BuiltInSystem): HTMLLIElement => {
    const li = document.createElement("li");
    li.textContent = system.name;
    li.append(tag("built in"));
    if (library.readOnly) {
      li.classList.add("empty"); // Nothing can be added without the dev server; not clickable.
      li.title = system.description;
      return li;
    }
    li.title = `${system.description} Not in the project yet; click to add it, switched on.`;
    li.addEventListener("click", () => {
      report("");
      try {
        model.addBuiltInSystem(system.name).catch((error: unknown) => report(messageOf(error)));
      } catch (error) {
        report(messageOf(error));
      }
    });
    return li;
  };

  const item = (script: Script): HTMLLIElement => {
    const { kind, name } = script;
    const li = document.createElement("li");
    li.textContent = name;
    li.title = `${kind}s/${name}`;
    const { selected } = model;
    li.classList.toggle("selected", selected?.kind === kind && selected.name === name);
    li.addEventListener("click", () => model.select({ kind, name }));

    if (model.isDirty(kind, name)) li.append(tag("unsaved", "tag unsaved"));
    const info = model.infoOf(kind, name);
    if (info?.error) {
      const mark = tag("!", "tag error");
      mark.title = info.error;
      li.append(mark);
    } else if (script.disabled) {
      li.append(tag("off", "tag"));
    } else if (info?.system) {
      const scenes = info.system.scenes;
      const where = tag(scenes === null ? "all scenes" : scenes.join(", "), "scenes");
      if (info.system.phase === "render") where.textContent += " · render";
      li.append(where);
    }
    return li;
  };

  const update = () => {
    const wasTyping = adding !== null && document.activeElement === forms[adding].input;
    root.replaceChildren(note, ...section("system"), ...section("component"), ...section("scene"));
    // Just opened, or rebuilt (e.g. a check finished) while the name was being typed.
    if (adding !== null && (focusForm || wasTyping)) {
      const { form, input } = forms[adding];
      (input.hidden ? (form.querySelector("select") ?? input) : input).focus();
    }
    focusForm = false;
  };
  model.onChange(update);
  update();
}
