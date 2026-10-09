/** Loads one image file. The default uses the browser's Image element. */
export type ImageLoader = (url: string) => Promise<HTMLImageElement>;

/** An image split into a grid of equal-size frames. */
export interface SheetSource {
  url: string;
  frameWidth: number;
  frameHeight: number;
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
}

export async function loadBrowserImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
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
      const frames = count === 1 ? "1 frame" : `${count} frames`;
      throw new Error(`Frame ${index} is out of range for "${name}" (${frames})`);
    }
    return {
      sx: (index % columns) * frameWidth,
      sy: Math.floor(index / columns) * frameHeight,
      sw: frameWidth,
      sh: frameHeight,
    };
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
      throw new Error(`Failed to load image "${name}" from ${url}`, { cause });
    }
    const { width, height } = image;

    if (typeof source === "string") {
      if (width === 0 || height === 0) {
        throw new Error(`Image "${name}" has no size (${width}x${height})`);
      }
      return { image, frameWidth: width, frameHeight: height, columns: 1, count: 1 };
    }

    const { frameWidth, frameHeight } = source;
    const columns = Math.floor(width / frameWidth);
    const rows = Math.floor(height / frameHeight);
    if (columns === 0 || rows === 0) {
      throw new Error(
        `Image "${name}" (${width}x${height}) is smaller than one ${frameWidth}x${frameHeight} frame`,
      );
    }
    return { image, frameWidth, frameHeight, columns, count: columns * rows };
  }
}
