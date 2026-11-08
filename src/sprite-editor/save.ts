import type { ImageFile } from "../engine";
import { imageNameFromText } from "../editor/image-names";

/** What to write to the image files for a sprite, and what the user should know about it. */
export interface SavePlan {
  name: string;
  /** True when an image file of this name is replaced. */
  replaces: boolean;
}

/**
 * Decides under which name a sprite is saved and whether that replaces an image file.
 * Throws with a message for the user when it can't be saved under `rawName`.
 */
export function planSave(rawName: string, files: readonly Pick<ImageFile, "name">[]): SavePlan {
  const name = imageNameFromText(rawName);
  if (name === "") throw new Error("Give the sprite a name (letters and numbers)");
  return { name, replaces: files.some((image) => image.name === name) };
}

/** The sentence the page shows after a save; `style` is how it was drawn ("pixel-art", "vector"). */
export function savedMessage(plan: SavePlan, frames: number, clips: number, style: string): string {
  const what =
    frames === 1 && clips === 0
      ? `${style} image`
      : `${style} sheet of ${frames} ${frames === 1 ? "frame" : "frames"} and ${clips} ${clips === 1 ? "clip" : "clips"}`;
  return `Saved "${plan.name}" as a ${what} in the project's images; it is in the scene editor's image list`;
}
