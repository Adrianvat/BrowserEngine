import {
  imageSource,
  withoutBuiltInClashes,
  type Assets,
  type ImageSource,
  type ImageStore,
  type StoredImage,
  type StoredSheet,
} from "../engine";
import { imageNameFromFile } from "./image-names";

export interface ImageLibraryOptions {
  /** The images declared in code; read-only here. */
  builtIns: Record<string, ImageSource>;
  store: ImageStore;
  /** The editor's Assets; every image is kept loaded in it. */
  assets: Assets;
  /** A URL the Assets loader can read for a file (URL.createObjectURL in the browser). */
  createUrl: (file: Blob) => string;
}

/** What the editor shows for one image. */
export interface ImageInfo {
  name: string;
  builtIn: boolean;
  /** null for a single image. */
  sheet: StoredSheet | null;
  /** Size in pixels; null when the image failed to load. */
  width: number | null;
  height: number | null;
  frameCount: number | null;
  error: string | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The built-in and uploaded images. Every write is checked, saved, then loaded into
 * Assets; a write that fails changes nothing. Writes run one at a time.
 */
export class ImageLibrary {
  private readonly uploaded = new Map<string, StoredImage>();
  private readonly urls = new Map<string, string>();
  private readonly errors = new Map<string, string>();
  private readonly listeners: (() => void)[] = [];
  /** The last write; the next one starts after it settles. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ImageLibraryOptions) {}

  /** False when the browser can't store images; uploading is then disabled. */
  get available(): boolean {
    return this.options.store.available;
  }

  /** Built-ins in definition order, then uploaded images sorted by name. */
  get names(): string[] {
    return [...Object.keys(this.options.builtIns), ...[...this.uploaded.keys()].sort()];
  }

  isBuiltIn(name: string): boolean {
    return Object.hasOwn(this.options.builtIns, name);
  }

  has(name: string): boolean {
    return this.isBuiltIn(name) || this.uploaded.has(name);
  }

  image(name: string): ImageInfo {
    const { assets } = this.options;
    const loaded = assets.hasImage(name);
    const element = loaded ? assets.getImage(name) : null;
    return {
      name,
      builtIn: this.isBuiltIn(name),
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

  /** Loads the built-ins (a failure rejects) and the stored images (a failure is kept on the image). */
  async load(): Promise<void> {
    const { assets, builtIns, store } = this.options;
    await assets.loadImages(builtIns);
    for (const image of withoutBuiltInClashes(await store.list(), builtIns)) {
      this.uploaded.set(image.name, image);
      try {
        await this.loadIntoAssets(image);
      } catch (error) {
        this.errors.set(image.name, messageOf(error));
      }
    }
    this.notify();
  }

  /** Stores a file as a new single image named after it. Resolves to the name. */
  add(file: Blob, fileName: string): Promise<string> {
    return this.write(async () => {
      if (!this.available) throw new Error("Images can't be saved in this browser");
      const name = imageNameFromFile(fileName, this.names);
      const image: StoredImage = { name, file };
      try {
        await this.loadIntoAssets(image);
      } catch {
        this.forget(name);
        throw new Error(`Couldn't read ${fileName} as an image`);
      }
      try {
        await this.options.store.save(image);
      } catch (error) {
        this.forget(name);
        throw new Error(`Couldn't save image: ${messageOf(error)}`);
      }
      this.uploaded.set(name, image);
      return name;
    });
  }

  remove(name: string): Promise<void> {
    return this.write(async () => {
      this.checkUploaded(name);
      try {
        await this.options.store.remove(name);
      } catch (error) {
        throw new Error(`Couldn't delete image: ${messageOf(error)}`);
      }
      this.uploaded.delete(name);
      this.errors.delete(name);
      this.forget(name);
    });
  }

  private sheetOf(name: string): StoredSheet | null {
    if (this.isBuiltIn(name)) {
      const source = this.options.builtIns[name];
      if (typeof source === "string") return null;
      return {
        frameWidth: source.frameWidth,
        frameHeight: source.frameHeight,
        animations: source.animations ?? {},
      };
    }
    const image = this.uploaded.get(name);
    if (!image) throw new Error(`Image "${name}" not found`);
    return image.sheet ?? null;
  }

  /** Throws unless `name` is an uploaded image. */
  private checkUploaded(name: string): StoredImage {
    if (this.isBuiltIn(name)) {
      throw new Error(`Image "${name}" is defined in code and can't be changed here`);
    }
    const image = this.uploaded.get(name);
    if (!image) throw new Error(`Image "${name}" not found`);
    return image;
  }

  private async loadIntoAssets(image: StoredImage): Promise<void> {
    let url = this.urls.get(image.name);
    if (url === undefined) {
      url = this.options.createUrl(image.file);
      this.urls.set(image.name, url);
    }
    await this.options.assets.loadImages({ [image.name]: imageSource(image, url) });
  }

  private forget(name: string): void {
    this.options.assets.removeImage(name);
    this.urls.delete(name);
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
