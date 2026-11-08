// With its extension: Vite's config loads this file through the dev-server plugin (tools/).
import type { AnimationClip, ImageSource } from "../assets/assets.ts";

/**
 * Images are files: `<name>.png` (or .svg, .jpg…) in the project's images folder, with an
 * optional `<name>.json` next to it giving a sprite sheet's frame size and clips. The dev
 * server serves and writes them for the editors, and the bundled game reads them through
 * this module, so they agree on what the images are.
 */

/** A sheet's layout, as kept in its `<name>.json`. */
export interface StoredSheet {
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, AnimationClip>;
}

/** One image in the images folder, as the editors and the game see it. */
export interface ImageFile {
  name: string;
  /** Where the image file can be fetched from. */
  url: string;
  /** The sheet layout from `<name>.json`; absent for a single image (one frame). */
  sheet?: StoredSheet;
  /** Why the image can't be used as it is, e.g. a sheet file that can't be read. */
  error?: string;
}

/** File extension -> content type, for every image format the folder can hold. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  svg: "image/svg+xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
};

const NAME = /^[A-Za-z0-9][\w-]*$/;

/** Whether `name` can name an image file: letters, digits, `_` and `-`. */
export function isImageName(name: string): boolean {
  return NAME.test(name);
}

/** The file extension for a content type ("image/png" -> "png"), or null for other types. */
export function extensionForType(type: string): string | null {
  const plain = type.split(";")[0].trim().toLowerCase();
  const found = Object.entries(IMAGE_TYPES).find(([, mime]) => mime === plain);
  return found ? found[0] : null;
}

/** The image file of a name and extension, relative to the images folder. */
export function imageFile(name: string, extension: string): string {
  return `${name}.${extension}`;
}

/** The sheet file of an image, relative to the images folder. */
export function sheetFile(name: string): string {
  return `${name}.json`;
}

/** The image a file path (e.g. "./hero.svg" or "hero.svg") names, or null for other files. */
export function imageFromFile(path: string): { name: string; extension: string } | null {
  const match = /(?:^|\/)([^/]+)\.([^./]+)$/.exec(path);
  if (!match) return null;
  const [, name, extension] = match;
  const lower = extension.toLowerCase();
  if (!isImageName(name) || !Object.hasOwn(IMAGE_TYPES, lower)) return null;
  return { name, extension: lower };
}

/** The image a sheet file path (e.g. "./hero.json") belongs to, or null for other files. */
export function sheetFromFile(path: string): string | null {
  const match = /(?:^|\/)([^/]+)\.json$/.exec(path);
  return match && isImageName(match[1]) ? match[1] : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Checks a sheet file's contents (parsed JSON) and returns a fresh copy. */
export function validateStoredSheet(value: unknown): StoredSheet {
  if (!isObject(value)) throw new Error("A sheet must be an object");
  const { frameWidth, frameHeight, animations = {} } = value;
  if (!isPositiveInteger(frameWidth) || !isPositiveInteger(frameHeight)) {
    throw new Error('"frameWidth" and "frameHeight" must be positive whole numbers');
  }
  if (!isObject(animations)) throw new Error('"animations" must be an object of clips');
  const clips: Record<string, AnimationClip> = {};
  for (const [name, clip] of Object.entries(animations)) {
    if (
      !isObject(clip) ||
      !Array.isArray(clip.frames) ||
      !clip.frames.every((frame) => typeof frame === "number") ||
      typeof clip.fps !== "number" ||
      (clip.loop !== undefined && typeof clip.loop !== "boolean")
    ) {
      throw new Error(
        `Clip "${name}" must have "frames" (numbers), "fps" (a number) and maybe "loop" (true or false)`,
      );
    }
    clips[name] = { frames: [...(clip.frames as number[])], fps: clip.fps };
    if (clip.loop !== undefined) clips[name].loop = clip.loop;
  }
  return { frameWidth, frameHeight, animations: clips };
}

/** A sheet as it is written to its file: one line per clip. */
export function formatStoredSheet(sheet: StoredSheet): string {
  const clips = Object.entries(sheet.animations).map(([name, clip]) => {
    const fields = [`"frames": [${clip.frames.join(", ")}]`, `"fps": ${JSON.stringify(clip.fps)}`];
    if (clip.loop !== undefined) fields.push(`"loop": ${clip.loop}`);
    return `    ${JSON.stringify(name)}: { ${fields.join(", ")} }`;
  });
  const animations = clips.length === 0 ? "{}" : `{\n${clips.join(",\n")}\n  }`;
  return `{\n  "frameWidth": ${sheet.frameWidth},\n  "frameHeight": ${sheet.frameHeight},\n  "animations": ${animations}\n}\n`;
}

/** Parses a sheet file's text. */
export function parseStoredSheet(text: string): StoredSheet {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateStoredSheet(value);
}

/**
 * The images among a set of files, by name: `files` maps each file's path to where it
 * can be fetched from, `sheets` maps each sheet file's path to its text. Files that are
 * not images are ignored. An image with a sheet that can't be read, or with more than
 * one file (slime.png and slime.svg, say), is kept with an `error`.
 */
export function collectImageFiles(
  files: Record<string, string>,
  sheets: Record<string, string>,
): ImageFile[] {
  const sheetTexts = new Map<string, string>();
  for (const [path, text] of Object.entries(sheets)) {
    const name = sheetFromFile(path);
    if (name !== null) sheetTexts.set(name, text);
  }
  const byName = new Map<string, { url: string; extensions: string[] }>();
  for (const path of Object.keys(files).sort()) {
    const image = imageFromFile(path);
    if (!image) continue;
    const entry = byName.get(image.name);
    if (entry) entry.extensions.push(image.extension);
    else byName.set(image.name, { url: files[path], extensions: [image.extension] });
  }
  const images: ImageFile[] = [];
  for (const [name, { url, extensions }] of byName) {
    const image: ImageFile = { name, url };
    if (extensions.length > 1) {
      const list = extensions.map((extension) => imageFile(name, extension)).join(", ");
      image.error = `"${name}" has more than one file (${list}); delete all but one`;
    } else if (sheetTexts.has(name)) {
      try {
        image.sheet = parseStoredSheet(sheetTexts.get(name)!);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        image.error = `${sheetFile(name)}: ${reason}`;
      }
    }
    images.push(image);
  }
  return images.sort((a, b) => a.name.localeCompare(b.name));
}

/** What Assets loads for an image file. */
export function imageSource(image: ImageFile): ImageSource {
  return image.sheet ? { url: image.url, ...image.sheet } : image.url;
}

/**
 * The image files, ready for Assets.loadImages. Throws for an image file that can't be
 * used, naming it, so the game fails to start with the reason.
 */
export function toImageSources(images: readonly ImageFile[]): Record<string, ImageSource> {
  const sources: Record<string, ImageSource> = {};
  for (const image of images) {
    if (image.error !== undefined) throw new Error(`Image "${image.name}": ${image.error}`);
    sources[image.name] = imageSource(image);
  }
  return sources;
}
