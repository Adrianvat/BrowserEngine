import type { ImageFilesClient } from "../dev-api/images";
import {
  checkSheet,
  imageSource,
  type AnimationClip,
  type Assets,
  type ImageFile,
  type StoredSheet,
} from "../engine";
import { imageNameFromFile, uniqueName } from "./image-names";

export interface ImageLibraryOptions {
  /** The image files in the project's images folder, through the dev server. */
  files: ImageFilesClient;
  /** What to show when the files can't be reached: the image files bundled with the page. */
  fallback?: () => Promise<readonly ImageFile[]>;
  /** The editor's Assets; every image is kept loaded in it. */
  assets: Assets;
}

/** What the editor shows for one image. */
export interface ImageInfo {
  name: string;
  /** null for a single image. */
  sheet: StoredSheet | null;
  /** Size in pixels; null when the image failed to load. */
  width: number | null;
  height: number | null;
  frameCount: number | null;
  error: string | null;
}

/** The parts of a clip to change; a new `name` renames it in place. */
export interface ClipChanges {
  name?: string;
  frames?: number[];
  fps?: number;
  loop?: boolean;
}

export const READ_ONLY = "Images can't be changed here: start the dev server (npm run dev)";

function requireSheet(image: ImageFile): StoredSheet {
  if (!image.sheet) throw new Error("Set a frame size before adding clips");
  return image.sheet;
}

function requireClip(sheet: StoredSheet, clip: string): AnimationClip {
  if (!Object.hasOwn(sheet.animations, clip)) throw new Error(`Clip "${clip}" not found`);
  return sheet.animations[clip];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The project's image files (its images folder). Every write is checked, written to the
 * files, then loaded into Assets; a write that fails changes nothing. Writes run one at
 * a time.
 */
export class ImageLibrary {
  private readonly folder = new Map<string, ImageFile>();
  private readonly errors = new Map<string, string>();
  private readonly listeners: (() => void)[] = [];
  private readOnly = false;
  /** The last write; the next one starts after it settles. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ImageLibraryOptions) {}

  /** False when the files can't be reached (no dev server); adding and editing is then disabled. */
  get available(): boolean {
    return !this.readOnly;
  }

  /** The image files, sorted by name. */
  get names(): string[] {
    return [...this.folder.keys()].sort();
  }

  has(name: string): boolean {
    return this.folder.has(name);
  }

  image(name: string): ImageInfo {
    const { assets } = this.options;
    const loaded = assets.hasImage(name);
    const element = loaded ? assets.getImage(name) : null;
    return {
      name,
      sheet: this.sheetOf(name),
      width: element?.width ?? null,
      height: element?.height ?? null,
      frameCount: loaded ? assets.frameCount(name) : null,
      error: this.errors.get(name) ?? null,
    };
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /**
   * Loads the image files, from the dev server or else the bundled fallback (a failure
   * to read them rejects; an image that fails to load is kept with its error).
   */
  async load(): Promise<void> {
    for (const image of await this.readFiles()) {
      this.folder.set(image.name, image);
      await this.loadIntoAssets(image);
    }
    this.notify();
  }

  /**
   * Re-reads the files after they changed on disk, e.g. in the sprite editor, and loads
   * the images among `names` again (every one, when no names are given). A new version is
   * loaded before the old one is dropped, so an image never goes missing while it is drawn.
   */
  reload(names?: readonly string[]): Promise<void> {
    return this.write(async () => {
      if (this.readOnly) return;
      const files = await this.options.files.load();
      const byName = new Map(files.map((image) => [image.name, image]));
      const affected = names ?? [...new Set([...this.folder.keys(), ...byName.keys()])];
      for (const name of affected) {
        const image = byName.get(name);
        if (!image) {
          this.folder.delete(name);
          this.errors.delete(name);
          this.options.assets.removeImage(name);
          continue;
        }
        this.folder.set(name, image);
        await this.loadIntoAssets(image);
      }
    });
  }

  /** Writes a file as a new single image named after it, and loads it. Resolves to the name. */
  add(file: Blob, fileName: string): Promise<string> {
    return this.write(async () => {
      this.checkWritable();
      const name = imageNameFromFile(fileName, this.names);
      try {
        await this.options.files.save(name, file, null);
      } catch (error) {
        throw new Error(`Couldn't save image: ${messageOf(error)}`);
      }
      const image = await this.find(name);
      this.folder.set(name, image);
      await this.loadIntoAssets(image);
      const problem = this.errors.get(name);
      if (problem !== undefined) {
        // Not an image after all (the file can't be decoded): take it out again.
        this.folder.delete(name);
        this.errors.delete(name);
        await this.options.files.remove(name).catch(() => {});
        throw new Error(`Couldn't read ${fileName} as an image: ${problem}`);
      }
      return name;
    });
  }

  remove(name: string): Promise<void> {
    return this.write(async () => {
      this.checkWritable();
      this.checkInFolder(name);
      try {
        await this.options.files.remove(name);
      } catch (error) {
        throw new Error(`Couldn't delete image: ${messageOf(error)}`);
      }
      this.folder.delete(name);
      this.errors.delete(name);
      this.options.assets.removeImage(name);
    });
  }

  /** Both null makes it a single image again (only once it has no clips). */
  setFrameSize(name: string, width: number | null, height: number | null): Promise<void> {
    return this.edit(name, (image) => {
      if ((width === null) !== (height === null)) {
        throw new Error("Set both frame width and height, or neither");
      }
      if (width === null || height === null) {
        if (image.sheet && Object.keys(image.sheet.animations).length > 0) {
          throw new Error("Remove the clips before making this a single image");
        }
        return null;
      }
      return {
        frameWidth: width,
        frameHeight: height,
        animations: image.sheet?.animations ?? {},
      };
    });
  }

  /** Adds "clip" (or "clip-2"…) playing frame 0 at 8 fps, looping. Resolves to its name. */
  async addClip(name: string): Promise<string> {
    let added = "";
    await this.edit(name, (image) => {
      const sheet = requireSheet(image);
      added = uniqueName("clip", Object.keys(sheet.animations));
      return {
        ...sheet,
        animations: { ...sheet.animations, [added]: { frames: [0], fps: 8, loop: true } },
      };
    });
    return added;
  }

  updateClip(name: string, clip: string, changes: ClipChanges): Promise<void> {
    return this.edit(name, (image) => {
      const sheet = requireSheet(image);
      const current = requireClip(sheet, clip);
      const newName = changes.name ?? clip;
      if (newName === "") throw new Error("Clip name can't be empty");
      if (newName !== clip && Object.hasOwn(sheet.animations, newName)) {
        throw new Error(`Clip "${newName}" already exists`);
      }
      const updated: AnimationClip = {
        frames: [...(changes.frames ?? current.frames)],
        fps: changes.fps ?? current.fps,
        loop: changes.loop ?? current.loop ?? true,
      };
      const animations: Record<string, AnimationClip> = {};
      for (const [key, value] of Object.entries(sheet.animations)) {
        if (key === clip) animations[newName] = updated;
        else animations[key] = value;
      }
      return { ...sheet, animations };
    });
  }

  removeClip(name: string, clip: string): Promise<void> {
    return this.edit(name, (image) => {
      const sheet = requireSheet(image);
      requireClip(sheet, clip);
      const animations = { ...sheet.animations };
      delete animations[clip];
      return { ...sheet, animations };
    });
  }

  /**
   * Replaces the image file of this name (or adds it) with `file` and `sheet`, e.g. an
   * image an older version of the editor kept in the browser, and loads it.
   */
  importImage(name: string, file: Blob, sheet: StoredSheet | null): Promise<void> {
    return this.write(async () => {
      this.checkWritable();
      await this.options.files.save(name, file, sheet);
      const image = await this.find(name);
      this.folder.set(name, image);
      await this.loadIntoAssets(image);
    });
  }

  /** The files from the dev server, or else the bundled fallback (read-only from then on). */
  private async readFiles(): Promise<ImageFile[]> {
    try {
      const files = await this.options.files.load();
      this.readOnly = false;
      return files;
    } catch (error) {
      if (!this.options.fallback) throw error;
      this.readOnly = true;
      return [...(await this.options.fallback())];
    }
  }

  /** An image as the files now have it, after a write. */
  private async find(name: string): Promise<ImageFile> {
    const image = (await this.options.files.load()).find((candidate) => candidate.name === name);
    if (!image) throw new Error(`Image "${name}" was written but is not in the files`);
    return image;
  }

  private sheetOf(name: string): StoredSheet | null {
    const image = this.folder.get(name);
    if (!image) throw new Error(`Image "${name}" not found`);
    return image.sheet ?? null;
  }

  private checkWritable(): void {
    if (this.readOnly) throw new Error(READ_ONLY);
  }

  /** Throws unless `name` is an image file. */
  private checkInFolder(name: string): ImageFile {
    const image = this.folder.get(name);
    if (!image) throw new Error(`Image "${name}" not found`);
    return image;
  }

  /**
   * Builds the next sheet of a loaded image file with `change` (null: a single image),
   * checks it against the image's size, writes it, then reloads the image into Assets.
   */
  private edit(name: string, change: (image: ImageFile) => StoredSheet | null): Promise<void> {
    return this.write(async () => {
      this.checkWritable();
      const current = this.checkInFolder(name);
      const { assets, files } = this.options;
      if (!assets.hasImage(name)) {
        throw new Error(`Image "${name}" could not be loaded; delete it and add it again`);
      }
      const sheet = change(current);
      if (sheet) {
        const { width, height } = assets.getImage(name);
        checkSheet(name, width, height, sheet);
      }
      try {
        await files.setSheet(name, sheet);
      } catch (error) {
        throw new Error(`Couldn't save image: ${messageOf(error)}`);
      }
      const next: ImageFile = sheet ? { ...current, sheet } : { name, url: current.url };
      this.folder.set(name, next);
      await this.loadIntoAssets(next);
    });
  }

  /** Loads the image into Assets; a failure is kept on the image (and the old version dropped). */
  private async loadIntoAssets(image: ImageFile): Promise<void> {
    this.errors.delete(image.name);
    try {
      if (image.error !== undefined) throw new Error(image.error);
      await this.options.assets.loadImages({ [image.name]: imageSource(image) });
    } catch (error) {
      this.options.assets.removeImage(image.name);
      this.errors.set(image.name, messageOf(error));
    }
  }

  /** Runs `action` after every earlier write; listeners hear about it if it succeeds. */
  private write<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result.then((value) => {
      this.notify();
      return value;
    });
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
