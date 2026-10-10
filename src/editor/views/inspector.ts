import type { FieldKind } from "../../engine";
import type { EditorModel } from "../model";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * The selected entity's name and components, one input per registered field.
 * It is rebuilt only when the selection or the component list changes. Otherwise
 * values are refreshed in place, skipping the focused input, so typing keeps focus.
 */
export function mountInspector(root: HTMLElement, model: EditorModel): void {
  let shape = "";
  const update = () => {
    const next = shapeOf(model);
    if (next !== shape) {
      shape = next;
      build(root, model);
    }
    refresh(root, model);
  };
  model.onChange(update);
  update();
}

function shapeOf(model: EditorModel): string {
  const index = model.selected;
  if (index === null || model.loadError) return "none";
  const components = Object.keys(model.data.entities[index].components);
  return JSON.stringify([model.scene, index, components]);
}

function build(root: HTMLElement, model: EditorModel): void {
  root.replaceChildren();
  const index = model.selected;
  if (index === null || model.loadError) return;
  const entity = model.data.entities[index];

  const name = document.createElement("input");
  name.type = "text";
  name.dataset.name = "";
  name.addEventListener("input", () => model.rename(index, name.value));
  root.append(row("Name", name));

  for (const componentName of Object.keys(entity.components)) {
    const definition = model.registry.get(componentName);
    if (!definition) continue;
    const section = document.createElement("section");
    section.className = "component";

    const title = document.createElement("h3");
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.title = `Remove ${componentName}`;
    remove.addEventListener("click", () => model.removeComponent(index, componentName));
    title.append(componentName, remove);
    section.append(title);

    for (const [field, kind] of Object.entries(definition.fields)) {
      section.append(row(field, fieldInput(model, index, componentName, field, kind)));
    }
    root.append(section);
  }

  const add = document.createElement("select");
  add.append(new Option("+ Add component", ""));
  for (const definition of model.registry.all()) {
    if (!Object.hasOwn(entity.components, definition.name)) {
      add.append(new Option(definition.name, definition.name));
    }
  }
  add.addEventListener("change", () => {
    if (add.value) model.addComponent(index, add.value);
  });
  root.append(add);
}

function row(label: string, input: HTMLElement): HTMLLabelElement {
  const element = document.createElement("label");
  element.className = "row";
  const text = document.createElement("span");
  text.textContent = label;
  element.append(text, input);
  return element;
}

/** Marks an input with the field it shows, for refresh(). */
function bind<T extends HTMLElement>(input: T, component: string, field: string): T {
  input.dataset.component = component;
  input.dataset.field = field;
  return input;
}

function fieldInput(
  model: EditorModel,
  index: number,
  component: string,
  field: string,
  kind: FieldKind,
): HTMLElement {
  const set = (value: unknown) => model.setField(index, component, field, value);

  if (typeof kind === "object" || kind === "image") {
    const select = bind(document.createElement("select"), component, field);
    const options = typeof kind === "object" ? kind.choice : model.imageNames;
    for (const option of options) select.append(new Option(option, option));
    select.addEventListener("change", () => set(select.value));
    return select;
  }

  const input = bind(document.createElement("input"), component, field);
  switch (kind) {
    case "number":
    case "optionalNumber":
      input.type = "number";
      input.addEventListener("input", () => {
        if (input.value === "") {
          if (kind === "optionalNumber") set(undefined);
          return;
        }
        if (Number.isFinite(input.valueAsNumber)) set(input.valueAsNumber);
      });
      return input;
    case "boolean":
      input.type = "checkbox";
      input.addEventListener("change", () => set(input.checked));
      return input;
    case "string":
      input.type = "text";
      input.addEventListener("input", () => set(input.value));
      return input;
    case "color": {
      input.type = "text";
      input.addEventListener("input", () => set(input.value));
      const picker = document.createElement("input");
      picker.type = "color";
      picker.dataset.picker = "";
      bind(picker, component, field);
      picker.addEventListener("input", () => set(picker.value));
      const wrapper = document.createElement("span");
      wrapper.className = "color";
      wrapper.append(input, picker);
      return wrapper;
    }
  }
}

/** Copies the model's values into the inputs, leaving the focused one alone. */
function refresh(root: HTMLElement, model: EditorModel): void {
  const index = model.selected;
  if (index === null || model.loadError) return;
  const entity = model.data.entities[index];

  const name = root.querySelector<HTMLInputElement>("input[data-name]");
  if (name && name !== document.activeElement) name.value = entity.name;

  for (const input of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    "[data-field]",
  )) {
    if (input === document.activeElement) continue;
    const { component = "", field = "" } = input.dataset;
    const value = model.fieldValue(index, component, field);
    if (input instanceof HTMLInputElement && input.type === "checkbox") {
      input.checked = value === true;
    } else if (input instanceof HTMLInputElement && "picker" in input.dataset) {
      if (typeof value === "string" && HEX_COLOR.test(value)) input.value = value;
    } else {
      input.value = value === undefined ? "" : String(value);
    }
  }
}
