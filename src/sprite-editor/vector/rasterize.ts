import { Pixels } from "../pixels";
import { drawShapes } from "./shapes";
import type { VectorFrame } from "./vector-document";

/** The frame's shapes painted onto pixels, the way the game would show them (smoothed). */
export function rasterizeFrame(frame: VectorFrame): Pixels {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is not available in this browser");
  drawShapes(ctx, frame.shapes);
  return new Pixels(frame.width, frame.height, ctx.getImageData(0, 0, frame.width, frame.height).data);
}
