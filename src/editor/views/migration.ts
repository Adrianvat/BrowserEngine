import type { ImageLibrary } from "../image-library";
import type { LegacyContent } from "../legacy-storage";
import type { EditorModel } from "../model";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Scenes and images are files in the project now. Those a previous version saved in the
 * browser are offered for import once, so that work is not lost, then forgotten either way.
 */
export function mountMigration(
  root: HTMLElement,
  model: EditorModel,
  library: ImageLibrary,
  legacy: LegacyContent | null,
): void {
  root.replaceChildren();
  if (!legacy || model.readOnly || !library.available || model.loadError !== null) return;
  const { scenes, images } = legacy;

  const found = [
    scenes.length > 0 ? count(scenes.length, "scene") : "",
    images.length > 0 ? count(images.length, "image") : "",
  ]
    .filter(Boolean)
    .join(" and ");
  const message = document.createElement("span");
  const verb = scenes.length + images.length === 1 ? "was" : "were";
  message.textContent =
    `${found} saved in this browser by an earlier version of the editor ${verb} found. ` +
    "Scenes and images are files of the project now (its scenes and images folders under projects/). " +
    "Import them, replacing the files with the same names?";

  const forget = () => {
    void legacy.forget();
    root.replaceChildren();
  };
  const doImport = document.createElement("button");
  doImport.textContent = "Import";
  doImport.addEventListener("click", () => {
    doImport.disabled = true;
    const work = async () => {
      for (const scene of scenes) await model.importScene(scene.name, scene.text);
      for (const image of images) await library.importImage(image.name, image.file, image.sheet);
    };
    work().then(forget, (error: unknown) => {
      message.textContent = `Couldn't import: ${messageOf(error)}`;
      doImport.disabled = false;
    });
  });
  const discard = document.createElement("button");
  discard.textContent = "Discard them";
  discard.addEventListener("click", forget);
  root.replaceChildren(message, doImport, discard);
}
