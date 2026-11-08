import type { ImageFilesClient } from "../../src/dev-api/images";
import { extensionForType, type ImageFile, type StoredSheet } from "../../src/engine";

interface Stored {
  file: Blob;
  sheet: StoredSheet | null;
  version: number;
}

/**
 * Stands in for the dev server's image files: a file and sheet per name, every call
 * logged, failures on demand. Each image's URL is "fake:<name>#<version>", the version
 * counting its saves, so a test's image loader can find the file behind a URL.
 */
export class FakeImageFiles implements ImageFilesClient {
  readonly images = new Map<string, Stored>();
  readonly calls: string[] = [];
  /** When set, every call fails with this message. */
  failure: string | null = null;
  /** When false, load() fails as if there were no dev server. */
  reachable = true;
  /** Images that list with this error (e.g. a broken sheet file), by name. */
  readonly errors = new Map<string, string>();

  /** Puts an image in, as if the file had been dropped into the folder. */
  put(name: string, file: Blob, sheet: StoredSheet | null = null): void {
    const version = (this.images.get(name)?.version ?? 0) + 1;
    this.images.set(name, { file, sheet: sheet && structuredClone(sheet), version });
  }

  /** The file behind a URL the client handed out, or undefined. */
  fileOf(url: string): Blob | undefined {
    const match = /^fake:([^#]+)#/.exec(url);
    return match ? this.images.get(match[1])?.file : undefined;
  }

  sheetOf(name: string): StoredSheet | null | undefined {
    const stored = this.images.get(name);
    return stored ? stored.sheet : undefined;
  }

  async load(): Promise<ImageFile[]> {
    this.calls.push("load");
    if (!this.reachable) throw new Error("/api/images is not there");
    this.check();
    return [...this.images]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, { sheet, version }]) => {
        const image: ImageFile = { name, url: `fake:${name}#${version}` };
        if (sheet) image.sheet = structuredClone(sheet);
        const error = this.errors.get(name);
        if (error !== undefined) image.error = error;
        return image;
      });
  }

  async save(name: string, file: Blob, sheet: StoredSheet | null): Promise<void> {
    this.calls.push(`save ${name}`);
    this.check();
    if (extensionForType(file.type) === null) throw new Error(`Unsupported image type "${file.type}"`);
    this.put(name, file, sheet);
  }

  async setSheet(name: string, sheet: StoredSheet | null): Promise<void> {
    this.calls.push(`sheet ${name}`);
    this.check();
    const stored = this.images.get(name);
    if (!stored) throw new Error(`There is no image "${name}"`);
    stored.sheet = sheet && structuredClone(sheet);
  }

  async remove(name: string): Promise<void> {
    this.calls.push(`remove ${name}`);
    this.check();
    this.images.delete(name);
  }

  private check(): void {
    if (this.failure !== null) throw new Error(this.failure);
  }
}
