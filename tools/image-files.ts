import {
  collectImageFiles,
  extensionForType,
  formatStoredSheet,
  IMAGE_TYPES,
  imageFile,
  imageFromFile,
  isImageName,
  sheetFile,
  validateStoredSheet,
  type ImageFile,
  type StoredSheet,
} from "../src/engine/data/image-files.ts";
import {
  ApiError,
  fromBase64,
  join,
  parseBody,
  respond,
  type ApiRequest,
  type ApiResponse,
  type FileSystem,
} from "./api.ts";

/** An image as the API lists it: like an ImageFile, but naming the file instead of a URL. */
export interface ImageFileEntry {
  name: string;
  /** E.g. "slime.png", under the images folder. */
  file: string;
  sheet?: StoredSheet;
  error?: string;
}

function checkName(name: string): void {
  if (!isImageName(name)) throw new Error(`"${name}" is not a valid image name`);
}

/**
 * A project's images as files in a folder (see engine/data/image-files): listing them,
 * reading one, saving one (the file and its sheet), changing a sheet and deleting one.
 * Every write goes to disk at once; nothing is cached, so files dropped into the folder
 * by other tools are always seen.
 */
export class ImageFiles {
  constructor(
    /** The images folder, e.g. "projects/demo/images". */
    private readonly root: string,
    private readonly fs: FileSystem,
  ) {}

  /** Every image, by name, with its sheet (or the error in it). */
  async list(): Promise<ImageFileEntry[]> {
    const files: Record<string, string> = {};
    const sheets: Record<string, string> = {};
    for (const entry of await this.fs.list(this.root)) {
      if (imageFromFile(entry)) files[entry] = entry;
      else if (entry.endsWith(".json")) {
        const text = await this.fs.read(join(this.root, entry));
        if (text !== null) sheets[entry] = text;
      }
    }
    return collectImageFiles(files, sheets).map(({ url, ...rest }: ImageFile) => ({
      ...rest,
      file: url,
    }));
  }

  /** An image file's bytes and content type, or null when there is no such file. */
  async read(file: string): Promise<{ bytes: Uint8Array; type: string } | null> {
    const image = imageFromFile(file);
    if (!image || file.includes("/")) throw new Error(`"${file}" is not an image file`);
    const bytes = await this.fs.readBytes(join(this.root, file));
    return bytes === null ? null : { bytes, type: IMAGE_TYPES[image.extension] };
  }

  /**
   * Writes an image's file (named after its type) and its sheet file, replacing the
   * image's earlier files whatever their format.
   */
  async save(name: string, type: string, bytes: Uint8Array, sheet: StoredSheet | null): Promise<void> {
    checkName(name);
    const extension = extensionForType(type);
    if (extension === null) throw new Error(`Unsupported image type "${type}"`);
    await this.fs.writeBytes(join(this.root, imageFile(name, extension)), bytes);
    for (const other of await this.imageFilesOf(name)) {
      if (other !== imageFile(name, extension)) await this.fs.remove(join(this.root, other));
    }
    await this.setSheet(name, sheet);
  }

  /**
   * Writes the sheet file of an existing image (keeping its line endings), or deletes it
   * for a single image.
   */
  async setSheet(name: string, sheet: StoredSheet | null): Promise<void> {
    checkName(name);
    if ((await this.imageFilesOf(name)).length === 0) throw new Error(`There is no image "${name}"`);
    const path = join(this.root, sheetFile(name));
    if (sheet === null) {
      await this.fs.remove(path);
      return;
    }
    let text = formatStoredSheet(sheet);
    if ((await this.fs.read(path))?.includes("\r\n")) text = text.replace(/\n/g, "\r\n");
    await this.fs.write(path, text);
  }

  /** Deletes an image's files, whatever their format, and its sheet file. */
  async remove(name: string): Promise<void> {
    checkName(name);
    for (const file of await this.imageFilesOf(name)) await this.fs.remove(join(this.root, file));
    await this.fs.remove(join(this.root, sheetFile(name)));
  }

  private async imageFilesOf(name: string): Promise<string[]> {
    return (await this.fs.list(this.root)).filter((entry) => imageFromFile(entry)?.name === name);
  }
}

function parseSheet(value: unknown): StoredSheet | null {
  if (value === null || value === undefined) return null;
  try {
    return validateStoredSheet(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ApiError(400, `"sheet" must be a sheet layout or null: ${reason}`);
  }
}

/**
 * The images API the scene and sprite editors talk to:
 *   GET    /                -> { version: 1, images: [{ name, file, sheet?, error? }] }
 *   GET    /files/<file>    -> the image file itself
 *   PUT    /<name>          { type: "image/png", data: <base64>, sheet: {...} | null }
 *   PUT    /<name>/sheet    { sheet: {...} | null }
 *   DELETE /<name>
 */
export function handleImagesRequest(
  files: ImageFiles,
  request: ApiRequest,
): Promise<ApiResponse> {
  return respond(async () => {
    const path = request.path.replace(/\/$/, "");
    if (path === "" && request.method === "GET") {
      return { status: 200, body: { version: 1, images: await files.list() } };
    }
    const file = /^\/files\/([^/]+)$/.exec(path);
    if (file && request.method === "GET") {
      if (!imageFromFile(file[1])) throw new ApiError(404, `"${file[1]}" is not an image file`);
      const found = await files.read(file[1]);
      if (!found) throw new ApiError(404, `There is no image file "${file[1]}"`);
      return { status: 200, file: found };
    }
    const image = /^\/([^/]+)(\/sheet)?$/.exec(path);
    if (image) {
      const [, name, sheetRoute] = image;
      if (!isImageName(name)) throw new ApiError(400, `"${name}" is not a valid image name`);
      if (sheetRoute && request.method === "PUT") {
        await files.setSheet(name, parseSheet(parseBody(request.body).sheet));
        return { status: 200, body: { ok: true } };
      }
      if (!sheetRoute && request.method === "PUT") {
        const { type, data, sheet } = parseBody(request.body);
        if (typeof type !== "string" || extensionForType(type) === null) {
          throw new ApiError(400, `"type" must be an image content type, e.g. "image/png"`);
        }
        let bytes: Uint8Array;
        try {
          if (typeof data !== "string") throw new Error("not a string");
          bytes = fromBase64(data);
        } catch {
          throw new ApiError(400, '"data" must be the file as base64 text');
        }
        await files.save(name, type, bytes, parseSheet(sheet));
        return { status: 200, body: { ok: true } };
      }
      if (!sheetRoute && request.method === "DELETE") {
        await files.remove(name);
        return { status: 200, body: { ok: true } };
      }
    }
    throw new ApiError(404, `No such route: ${request.method} ${request.path}`);
  });
}
