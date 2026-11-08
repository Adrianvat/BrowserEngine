import { loadBrowserImage } from "../engine/assets/browser-loader";
import { MAX_SIZE, Pixels } from "./pixels";

function context(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is not available in this browser");
  return [canvas, ctx];
}

/** The pixels as a PNG file, which is lossless, so they come back exactly. */
export function toPngBlob(pixels: Pixels): Promise<Blob> {
  const [canvas, ctx] = context(pixels.width, pixels.height);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Couldn't encode the sprite as PNG"));
    }, "image/png");
  });
}

/** The pixels of the image at `url` (a site URL or an object URL for a stored file). */
export async function pixelsFromUrl(url: string): Promise<Pixels> {
  const image = await loadBrowserImage(url);
  const { width, height } = image;
  if (width > MAX_SIZE || height > MAX_SIZE) {
    throw new Error(`That image is ${width}x${height}; the sprite editor handles up to ${MAX_SIZE}x${MAX_SIZE}`);
  }
  const [, ctx] = context(width, height);
  ctx.drawImage(image, 0, 0);
  return new Pixels(width, height, ctx.getImageData(0, 0, width, height).data);
}

/** The pixels of an image file. */
export async function pixelsFromFile(file: Blob): Promise<Pixels> {
  const url = URL.createObjectURL(file);
  try {
    return await pixelsFromUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
