import {
  imageFromFile,
  isImageName,
  validateStoredSheet,
  type ImageFile,
  type StoredSheet,
} from "../engine";
import { callApi, type ApiOptions } from "./call";

/** Where images are kept: the project's files, through the dev server's API. */
export interface ImageFilesClient {
  /** Every image, with a URL its file can be fetched from. Throws when the files can't be reached. */
  load(): Promise<ImageFile[]>;
  /** Writes an image's file and sheet, replacing the image of that name if there is one. */
  save(name: string, file: Blob, sheet: StoredSheet | null): Promise<void>;
  /** Changes an existing image's sheet; null makes it a single image. */
  setSheet(name: string, sheet: StoredSheet | null): Promise<void>;
  remove(name: string): Promise<void>;
}

/** Checks one entry of the server's image list and turns its file name into a URL. */
function imageFileFrom(value: unknown, urlOf: (file: string) => string): ImageFile {
  if (typeof value !== "object" || value === null) throw new Error("not an object");
  const { name, file, sheet, error } = value as Record<string, unknown>;
  if (typeof name !== "string" || !isImageName(name)) throw new Error("bad name");
  if (typeof file !== "string" || !imageFromFile(file) || file.includes("/")) {
    throw new Error(`bad file for "${name}"`);
  }
  const image: ImageFile = { name, url: urlOf(file) };
  if (sheet !== undefined) image.sheet = validateStoredSheet(sheet);
  if (error !== undefined) {
    if (typeof error !== "string") throw new Error(`bad error for "${name}"`);
    image.error = error;
  }
  return image;
}

/** Checks the server's answer to GET /api/images and returns its images. */
export function validateImageFiles(value: unknown, urlOf: (file: string) => string): ImageFile[] {
  const { version, images } = (value ?? {}) as { version?: unknown; images?: unknown };
  if (version !== 1 || !Array.isArray(images)) {
    throw new Error("The images API answered with something other than image files");
  }
  try {
    return images.map((entry) => imageFileFrom(entry, urlOf));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The images API answered with a broken image list: ${reason}`);
  }
}

/** A file's bytes as base64 text, for the API's JSON. */
export async function encodeFile(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The dev server's /api/images (see tools/image-files.ts for the routes). */
export class ImagesApi implements ImageFilesClient {
  private readonly options: ApiOptions;

  constructor(base = "/api/images", fetchFn?: typeof fetch) {
    this.options = { base, fetchFn };
  }

  async load(): Promise<ImageFile[]> {
    const answer = await callApi(this.options, "GET", "");
    return validateImageFiles(answer, (file) => `${this.options.base}/files/${file}`);
  }

  async save(name: string, file: Blob, sheet: StoredSheet | null): Promise<void> {
    const data = await encodeFile(file);
    await callApi(this.options, "PUT", `/${name}`, { type: file.type, data, sheet });
  }

  async setSheet(name: string, sheet: StoredSheet | null): Promise<void> {
    await callApi(this.options, "PUT", `/${name}/sheet`, { sheet });
  }

  async remove(name: string): Promise<void> {
    await callApi(this.options, "DELETE", `/${name}`);
  }
}
