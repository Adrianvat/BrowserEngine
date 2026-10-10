import { Assets, browserSceneStore } from "../engine";
import { definition } from "../game/definition";
import { EditorModel } from "./model";
import { mountTopBar } from "./views/top-bar";
import { mountViewport } from "./views/viewport";

function element<T extends HTMLElement>(selector: string, type: new () => T): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Editor element not found: ${selector}`);
  return found;
}

const model = new EditorModel(definition, browserSceneStore());
const assets = new Assets();
try {
  await assets.loadImages(definition.images);
} catch (error) {
  document.body.textContent = `Failed to load images: ${
    error instanceof Error ? error.message : String(error)
  }`;
  throw error;
}

mountTopBar(element("#topbar", HTMLElement), model);
mountViewport(element("#viewport", HTMLCanvasElement), model, assets);
