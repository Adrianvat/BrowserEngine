import { Assets, browserImageStore, browserSceneStore } from "../engine";
import { definition } from "../game/definition";
import { ImageLibrary } from "./image-library";
import { EditorModel } from "./model";
import { mountEntityList } from "./views/entity-list";
import { mountImageList } from "./views/image-list";
import { mountInspector } from "./views/inspector";
import { mountTopBar } from "./views/top-bar";
import { mountViewport } from "./views/viewport";

function element<T extends HTMLElement>(selector: string, type: new () => T): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Editor element not found: ${selector}`);
  return found;
}

const assets = new Assets();
const library = new ImageLibrary({
  builtIns: definition.images,
  store: await browserImageStore(),
  assets,
  createUrl: (file) => URL.createObjectURL(file),
});
const model = new EditorModel(definition, browserSceneStore(), () => library.names);
try {
  await library.load();
} catch (error) {
  document.body.textContent = `Failed to load images: ${
    error instanceof Error ? error.message : String(error)
  }`;
  throw error;
}
library.onChange(() => model.imagesChanged());

mountTopBar(element("#topbar", HTMLElement), model);
mountViewport(element("#viewport", HTMLCanvasElement), model, assets);
mountEntityList(element("#entities", HTMLElement), model);
mountImageList(element("#images", HTMLElement), library, model, assets);
mountInspector(element("#inspector", HTMLElement), model);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Delete" || model.selected === null || model.loadError) return;
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  model.removeEntity(model.selected);
});
