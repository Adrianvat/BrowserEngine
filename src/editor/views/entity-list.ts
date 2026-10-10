import type { EditorModel } from "../model";

/** The scene's entities by name, with Add and Remove. */
export function mountEntityList(root: HTMLElement, model: EditorModel): void {
  const update = () => {
    root.replaceChildren();
    if (model.loadError) return;

    const add = document.createElement("button");
    add.textContent = "+ Add entity";
    add.addEventListener("click", () => model.addEntity());

    const list = document.createElement("ul");
    model.data.entities.forEach((entity, index) => {
      const item = document.createElement("li");
      item.textContent = entity.name || "(unnamed)";
      item.classList.toggle("selected", index === model.selected);
      item.addEventListener("click", () => model.select(index));
      list.append(item);
    });

    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.disabled = model.selected === null;
    remove.addEventListener("click", () => {
      if (model.selected !== null) model.removeEntity(model.selected);
    });

    root.append(add, list, remove);
  };
  model.onChange(update);
  update();
}
