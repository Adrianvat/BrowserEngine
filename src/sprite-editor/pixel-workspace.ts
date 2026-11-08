import type { StoredSheet } from "../engine";
import { toPngBlob } from "./browser-image";
import { SpriteDocument } from "./document";
import type { Pixels } from "./pixels";
import { pixelsToShapes } from "./vector/convert";
import { VectorWorkspace } from "./vector-workspace";
import { mountAnimationPanel } from "./views/animation-panel";
import { mountCanvasView } from "./views/canvas-view";
import { mountFrameStrip, type FrameRenderer } from "./views/frame-strip";
import { installShortcuts, mountToolPanel } from "./views/tool-panel";
import type { Mounts, Report, Workspace } from "./workspace";

/** Draws a pixel document's frames crisply at any scale. */
export function pixelRenderer(doc: SpriteDocument): FrameRenderer {
  const backing = document.createElement("canvas");
  const backingCtx = backing.getContext("2d");
  return (ctx, index, scale) => {
    if (!backingCtx) return;
    const pixels: Pixels | undefined = index === doc.frame ? doc.pixels : doc.frames[index];
    if (!pixels) return;
    if (backing.width !== pixels.width || backing.height !== pixels.height) {
      backing.width = pixels.width;
      backing.height = pixels.height;
    }
    backingCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(backing, 0, 0, pixels.width * scale, pixels.height * scale);
  };
}

/** The pixel-art editor: a SpriteDocument with the brush tools. */
export class PixelWorkspace implements Workspace {
  readonly style = "pixel";
  readonly label = "pixel-art";
  readonly lossyToConvert = false;
  private controller: AbortController | null = null;

  constructor(readonly doc = new SpriteDocument()) {}

  reset(width: number, height: number): void {
    this.doc.reset(width, height);
  }

  async export(): Promise<{ file: Blob; sheet: StoredSheet | null }> {
    const { pixels, sheet } = this.doc.toSheet();
    return { file: await toPngBlob(pixels), sheet };
  }

  mount(mounts: Mounts, report: Report): void {
    this.unmount();
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    const canvas = document.createElement("canvas");
    canvas.id = "sprite";
    mounts.view.replaceChildren(canvas);
    const view = mountCanvasView(canvas, this.doc, signal);
    mountToolPanel(mounts.tools, this.doc, view);
    const render = pixelRenderer(this.doc);
    mountFrameStrip(mounts.frames, this.doc, render, report, signal);
    mountAnimationPanel(mounts.animation, this.doc, render, report, signal);
    installShortcuts(this.doc, signal);
  }

  unmount(): void {
    this.controller?.abort();
    this.controller = null;
  }

  /** Every run of same-colored pixels becomes a rectangle, so the picture stays the same. */
  convert(): Workspace {
    const doc = this.doc;
    const frames = doc.frames.map((frame, index) => {
      const pixels = index === doc.frame ? doc.pixels : frame;
      return { width: pixels.width, height: pixels.height, shapes: pixelsToShapes(pixels) };
    });
    const vector = new VectorWorkspace();
    // Traced pixel art should stay crisp in the game; a blank sprite is a fresh vector drawing.
    const traced = frames.some((frame) => frame.shapes.length > 0);
    vector.doc.openFrames(frames, doc.clips, doc.isSheet, doc.name, doc.openedFrom, doc.dirty, traced);
    return vector;
  }
}
