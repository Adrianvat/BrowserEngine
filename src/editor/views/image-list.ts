import type { Assets } from "../../engine";
import type { ImageLibrary } from "../image-library";
import type { EditorModel } from "../model";
import { mountImageDetails } from "./image-details";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The Images panel: every image by name, Add image, and the selected image's details. */
export function mountImageList(
  root: HTMLElement,
  library: ImageLibrary,
  model: EditorModel,
  assets: Assets,
): void {
  let selected: string | null = null;
  let message = "";

  const title = document.createElement("h2");
  title.textContent = "Images";

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/*";
  picker.hidden = true;

  const add = document.createElement("button");
  add.textContent = "+ Add image";
  add.addEventListener("click", () => picker.click());

  const note = document.createElement("p");
  note.className = "error";

  const list = document.createElement("ul");
  const details = document.createElement("div");

  const report = (text: string) => {
    message = text;
    note.textContent = library.available
      ? message
      : ["Images can't be saved in this browser", message].filter(Boolean).join(". ");
  };
  const show = mountImageDetails(details, library, model, assets, report);

  picker.addEventListener("change", () => {
    for (const file of picker.files ?? []) {
      library.add(file, file.name).then(
        (name) => {
          selected = name;
          report("");
          update();
        },
        (error: unknown) => report(messageOf(error)),
      );
    }
    picker.value = "";
  });

  const update = () => {
    if (selected !== null && !library.has(selected)) selected = null;
    add.disabled = !library.available;
    report(message);
    list.replaceChildren();
    for (const name of library.names) {
      const info = library.image(name);
      const item = document.createElement("li");
      item.textContent = name;
      item.classList.toggle("selected", name === selected);
      if (info.builtIn) item.append(tag("code"));
      if (info.error) {
        const marker = tag("!");
        marker.classList.add("error");
        marker.title = info.error;
        item.append(marker);
      }
      item.addEventListener("click", () => {
        selected = selected === name ? null : name;
        update();
      });
      list.append(item);
    }
    show(selected);
  };

  root.replaceChildren(title, add, picker, note, list, details);
  library.onChange(update);
  update();
}

function tag(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "tag";
  span.textContent = text;
  return span;
}
