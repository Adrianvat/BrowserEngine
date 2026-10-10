import type { ImageStorage, StoredImage } from "../../src/engine";

/** Copies a record the way IndexedDB would, so callers can't change what is stored. */
function copy(image: StoredImage): StoredImage {
  return image.sheet
    ? { name: image.name, file: image.file, sheet: structuredClone(image.sheet) }
    : { name: image.name, file: image.file };
}

/** Stands in for IndexedDB. */
export class MemoryImageStorage implements ImageStorage {
  readonly images = new Map<string, StoredImage>();
  /** When set, save and remove reject with this message (e.g. a full quota). */
  failWith: string | null = null;

  async list(): Promise<StoredImage[]> {
    return [...this.images.values()].map(copy);
  }

  async save(image: StoredImage): Promise<void> {
    this.check();
    this.images.set(image.name, copy(image));
  }

  async remove(name: string): Promise<void> {
    this.check();
    this.images.delete(name);
  }

  private check(): void {
    if (this.failWith !== null) throw new Error(this.failWith);
  }
}
