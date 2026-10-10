import { loadBrowserImage } from "./browser-loader";

/** Loads one image file. The default downloads and decodes it in the browser. */
export type ImageLoader = (url: string) => Promise<HTMLImageElement>;

/** A named sequence of sheet frames played at a fixed speed. */
export interface AnimationClip {
  /** Sheet frame indices, in playback order. */
  frames: number[];
  /** Frames per second. */
  fps: number;
  /** Start again after the last frame (default true); otherwise stop on it. */
  loop?: boolean;
}

/** An image split into a grid of equal-size frames. */
export interface SheetSource {
  url: string;
  frameWidth: number;
  frameHeight: number;
  /** Named clips that play frames of this sheet. */
  animations?: Record<string, AnimationClip>;
}

/** A plain URL loads a single image; a SheetSource loads a sprite sheet. */
export type ImageSource = string | SheetSource;

/** The part of an image to draw, in source pixels. */
export interface Frame {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface LoadedImage {
  image: HTMLImageElement;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  count: number;
  animations: Map<string, Required<AnimationClip>>;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function frameCountText(count: number): string {
  return count === 1 ? "1 frame" : `${count} frames`;
}

/** Checks a sheet's clips against its frame count and copies them, filling in defaults. */
function checkAnimations(
  image: string,
  count: number,
  animations: Record<string, AnimationClip>,
): Map<string, Required<AnimationClip>> {
  const checked = new Map<string, Required<AnimationClip>>();
  for (const [name, clip] of Object.entries(animations)) {
    const label = `Animation "${name}" of image "${image}"`;
    if (clip.frames.length === 0) throw new Error(`${label} has no frames`);
    if (!(Number.isFinite(clip.fps) && clip.fps > 0)) {
      throw new Error(`${label} has invalid fps (${clip.fps})`);
    }
    for (const frame of clip.frames) {
      if (!Number.isInteger(frame) || frame < 0 || frame >= count) {
        throw new Error(`${label}: frame ${frame} is out of range (${frameCountText(count)})`);
      }
    }
    checked.set(name, { frames: [...clip.frames], fps: clip.fps, loop: clip.loop ?? true });
  }
  return checked;
}

/** A sprite sheet's layout: a SheetSource without its file. */
export type SheetLayout = Omit<SheetSource, "url">;

/** A sheet's grid and clips, checked against the image's size. */
export interface CheckedSheet {
  columns: number;
  count: number;
  animations: Map<string, Required<AnimationClip>>;
}

/**
 * Checks a sheet layout against the image's size in pixels, with the messages
 * loadImages uses. The editor calls it before saving a sheet.
 */
export function checkSheet(
  name: string,
  width: number,
  height: number,
  sheet: SheetLayout,
): CheckedSheet {
  const { frameWidth, frameHeight } = sheet;
  if (!(isPositiveInteger(frameWidth) && isPositiveInteger(frameHeight))) {
    throw new Error(`Invalid frame size for image "${name}"`);
  }
  const columns = Math.floor(width / frameWidth);
  const rows = Math.floor(height / frameHeight);
  if (columns === 0 || rows === 0) {
    throw new Error(
      `Image "${name}" (${width}x${height}) is smaller than one ${frameWidth}x${frameHeight} frame`,
    );
  }
  const count = columns * rows;
  return { columns, count, animations: checkAnimations(name, count, sheet.animations ?? {}) };
}

/** Images loaded before the game starts, stored as a World resource. */
export class Assets {
  private readonly images = new Map<string, LoadedImage>();

  constructor(private readonly loader: ImageLoader = loadBrowserImage) {}

  /**
   * Loads all images in parallel. If any fails, none of them are kept and the
   * promise rejects with an error naming the image.
   */
  async loadImages(sources: Record<string, ImageSource>): Promise<void> {
    const loaded = await Promise.all(
      Object.entries(sources).map(
        async ([name, source]) => [name, await this.loadOne(name, source)] as const,
      ),
    );
    for (const [name, image] of loaded) this.images.set(name, image);
  }

  getImage(name: string): HTMLImageElement {
    return this.entry(name).image;
  }

  hasImage(name: string): boolean {
    return this.images.has(name);
  }

  frameCount(name: string): number {
    return this.entry(name).count;
  }

  /** Frames are numbered from 0, left to right, then top to bottom. */
  getFrame(name: string, index: number): Frame {
    const { frameWidth, frameHeight, columns, count } = this.entry(name);
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new Error(`Frame ${index} is out of range for "${name}" (${frameCountText(count)})`);
    }
    return {
      sx: (index % columns) * frameWidth,
      sy: Math.floor(index / columns) * frameHeight,
      sw: frameWidth,
      sh: frameHeight,
    };
  }

  /** A clip declared on a sheet; `loop` is always filled in. */
  getAnimation(image: string, name: string): Required<AnimationClip> {
    const clip = this.entry(image).animations.get(name);
    if (!clip) throw new Error(`Animation "${name}" not found for image "${image}"`);
    return clip;
  }

  hasAnimation(image: string, name: string): boolean {
    return this.images.get(image)?.animations.has(name) ?? false;
  }

  /** Forgets an image; unknown names are ignored. */
  removeImage(name: string): void {
    this.images.delete(name);
  }

  private entry(name: string): LoadedImage {
    const entry = this.images.get(name);
    if (!entry) throw new Error(`Image "${name}" is not loaded`);
    return entry;
  }

  private async loadOne(name: string, source: ImageSource): Promise<LoadedImage> {
    const url = typeof source === "string" ? source : source.url;
    if (
      typeof source !== "string" &&
      !(isPositiveInteger(source.frameWidth) && isPositiveInteger(source.frameHeight))
    ) {
      throw new Error(`Invalid frame size for image "${name}"`);
    }

    let image: HTMLImageElement;
    try {
      image = await this.loader(url);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Failed to load image "${name}" from ${url}: ${reason}`, { cause });
    }
    const { width, height } = image;

    if (typeof source === "string") {
      if (width === 0 || height === 0) {
        throw new Error(`Image "${name}" has no size (${width}x${height})`);
      }
      return {
        image,
        frameWidth: width,
        frameHeight: height,
        columns: 1,
        count: 1,
        animations: new Map(),
      };
    }

    const { columns, count, animations } = checkSheet(name, width, height, source);
    const { frameWidth, frameHeight } = source;
    return { image, frameWidth, frameHeight, columns, count, animations };
  }
}
