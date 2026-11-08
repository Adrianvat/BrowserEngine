import type { ImageFilesClient } from "../dev-api/images";
import type { ImageFile, StoredSheet } from "../engine";
import { planSave, type SavePlan } from "./save";

export interface SpriteLibraryOptions {
  /** The image files in the project's images folder, through the dev server. */
  files: ImageFilesClient;
  /** What to show when the files can't be reached: the image files bundled with the page. */
  fallback?: () => Promise<readonly ImageFile[]>;
  /** Downloads an image's file from its URL. */
  fetchFile: (url: string) => Promise<Blob>;
}

/** An image's file with its sheet layout, as opened in the editor. */
export interface LoadedImage {
  file: Blob;
  sheet: StoredSheet | null;
}

export const READ_ONLY = "Sprites can't be saved here: start the dev server (npm run dev)";

/** The images the sprite editor can open, and the files it saves to (the project's images folder). */
export class SpriteLibrary {
  private readOnly = false;

  constructor(private readonly options: SpriteLibraryOptions) {}

  /** False when the files can't be reached (no dev server); saving is then impossible. */
  get available(): boolean {
    return !this.readOnly;
  }

  /** The image files' names, sorted. */
  async list(): Promise<string[]> {
    return (await this.files()).map((image) => image.name).sort();
  }

  /** An image's file, and its sheet layout if it has one. */
  async load(name: string): Promise<LoadedImage> {
    const image = (await this.files()).find((candidate) => candidate.name === name);
    if (!image) throw new Error(`Image "${name}" not found`);
    if (image.error !== undefined) throw new Error(image.error);
    return { file: await this.options.fetchFile(image.url), sheet: image.sheet ?? null };
  }

  /** How saving as `rawName` would go; throws when the name can't be used. */
  async plan(rawName: string): Promise<SavePlan> {
    return planSave(rawName, await this.files());
  }

  /** Writes the file (with the sheet layout, for a sheet) as the plan says. */
  async save(plan: SavePlan, file: Blob, sheet: StoredSheet | null): Promise<void> {
    if (this.readOnly) throw new Error(READ_ONLY);
    await this.options.files.save(plan.name, file, sheet);
  }

  /** The image files, from the dev server or else the bundled fallback (read-only from then on). */
  private async files(): Promise<readonly ImageFile[]> {
    try {
      const files = await this.options.files.load();
      this.readOnly = false;
      return files;
    } catch (error) {
      if (!this.options.fallback) throw error;
      this.readOnly = true;
      return this.options.fallback();
    }
  }
}
