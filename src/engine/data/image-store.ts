import type { AnimationClip, ImageSource } from "../assets/assets";

/** A stored image's sprite sheet layout. */
export interface StoredSheet {
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, AnimationClip>;
}

/** An image uploaded in the editor. */
export interface StoredImage {
  name: string;
  /** The uploaded file, unchanged. */
  file: Blob;
  /** Absent for a single image (one frame). */
  sheet?: StoredSheet;
}

/** Where uploaded images are kept: IndexedDB in the browser. */
export interface ImageStorage {
  list(): Promise<StoredImage[]>;
  /** Adds the image, or replaces the one with the same name. */
  save(image: StoredImage): Promise<void>;
  remove(name: string): Promise<void>;
}

const UNAVAILABLE = "Images can't be saved in this browser";

/** Images uploaded in the editor, kept in browser storage. */
export class ImageStore {
  constructor(private readonly storage: ImageStorage | null) {}

  /** False when the browser has no usable storage; built-ins still work. */
  get available(): boolean {
    return this.storage !== null;
  }

  async list(): Promise<StoredImage[]> {
    return this.storage ? this.storage.list() : [];
  }

  async save(image: StoredImage): Promise<void> {
    await this.required().save(image);
  }

  async remove(name: string): Promise<void> {
    await this.required().remove(name);
  }

  private required(): ImageStorage {
    if (!this.storage) throw new Error(UNAVAILABLE);
    return this.storage;
  }
}

const DATABASE = "browser-engine";
const OBJECT_STORE = "images";

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves when a write transaction is committed; a full quota rejects here. */
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Transaction aborted"));
  });
}

class IndexedDbStorage implements ImageStorage {
  constructor(private readonly db: IDBDatabase) {}

  list(): Promise<StoredImage[]> {
    const store = this.db.transaction(OBJECT_STORE).objectStore(OBJECT_STORE);
    return result(store.getAll() as IDBRequest<StoredImage[]>);
  }

  save(image: StoredImage): Promise<void> {
    const transaction = this.db.transaction(OBJECT_STORE, "readwrite");
    transaction.objectStore(OBJECT_STORE).put(image);
    return committed(transaction);
  }

  remove(name: string): Promise<void> {
    const transaction = this.db.transaction(OBJECT_STORE, "readwrite");
    transaction.objectStore(OBJECT_STORE).delete(name);
    return committed(transaction);
  }
}

/** A store backed by IndexedDB, or by nothing when the browser has none or blocks it. */
export async function browserImageStore(): Promise<ImageStore> {
  try {
    if (!globalThis.indexedDB) return new ImageStore(null);
    const open = globalThis.indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(OBJECT_STORE, { keyPath: "name" });
    };
    return new ImageStore(new IndexedDbStorage(await result(open)));
  } catch {
    return new ImageStore(null);
  }
}

/** What Assets loads for a stored image, given a URL for its file. */
export function imageSource(image: StoredImage, url: string): ImageSource {
  return image.sheet ? { url, ...image.sheet } : url;
}

/** Drops (with a warning) uploaded images that have a built-in's name: the built-in wins. */
export function withoutBuiltInClashes(
  stored: StoredImage[],
  builtIns: Record<string, ImageSource>,
): StoredImage[] {
  return stored.filter((image) => {
    if (!Object.hasOwn(builtIns, image.name)) return true;
    console.warn(`Uploaded image "${image.name}" is ignored: an image declared in code has that name`);
    return false;
  });
}

/** The built-ins plus the uploaded images, ready for Assets.loadImages. */
export function toImageSources(
  stored: StoredImage[],
  builtIns: Record<string, ImageSource>,
  createUrl: (file: Blob) => string,
): Record<string, ImageSource> {
  const sources: Record<string, ImageSource> = { ...builtIns };
  for (const image of withoutBuiltInClashes(stored, builtIns)) {
    sources[image.name] = imageSource(image, createUrl(image.file));
  }
  return sources;
}
