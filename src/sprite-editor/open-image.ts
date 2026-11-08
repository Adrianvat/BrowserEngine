import type { StoredSheet } from "../engine";
import { pixelsFromFile } from "./browser-image";
import { PixelWorkspace } from "./pixel-workspace";
import { VectorWorkspace } from "./vector-workspace";
import type { Workspace } from "./workspace";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function looksLikeSvg(file: Blob): boolean {
  return file.type === "image/svg+xml" || file.type.includes("svg");
}

/**
 * A workspace editing an image file: the vector editor for an SVG whose shapes can be
 * read, the pixel editor for anything else (an SVG that can't be read as shapes is
 * painted into pixels). The notes say what was lost on the way, if anything.
 */
export async function workspaceForFile(
  file: Blob,
  name: string,
  openedFrom: string | null,
  sheet: StoredSheet | null,
): Promise<{ workspace: Workspace; notes: string[] }> {
  const notes: string[] = [];
  if (looksLikeSvg(file)) {
    try {
      const vector = new VectorWorkspace();
      notes.push(...vector.doc.openSvg(await file.text(), name, openedFrom, sheet));
      return { workspace: vector, notes };
    } catch (error) {
      notes.push(`Couldn't read the SVG's shapes (${messageOf(error)}), so it was opened as pixel art`);
    }
  }
  const pixel = new PixelWorkspace();
  pixel.doc.open(await pixelsFromFile(file), name, openedFrom, sheet);
  return { workspace: pixel, notes };
}
