import type { StoredSheet } from "../engine";
import { PixelWorkspace } from "./pixel-workspace";
import { rasterizeFrame } from "./vector/rasterize";
import { drawShapes } from "./vector/shapes";
import { VectorDocument } from "./vector/vector-document";
import { mountVectorCanvas } from "./vector/views/vector-canvas";
import { installVectorShortcuts, mountVectorTools } from "./vector/views/vector-tools";
import { mountAnimationPanel } from "./views/animation-panel";
import { mountFrameStrip, type FrameRenderer } from "./views/frame-strip";
import type { Mounts, Report, Workspace } from "./workspace";

/** Draws a vector document's frames at any scale. */
export function vectorRenderer(doc: VectorDocument): FrameRenderer {
  return (ctx, index, scale) => {
    const frame = doc.frames[index];
    if (!frame) return;
    ctx.save();
    ctx.scale(scale, scale);
    drawShapes(ctx, frame.shapes);
    ctx.restore();
  };
}

/** The vector editor: a VectorDocument with the shape tools. */
export class VectorWorkspace implements Workspace {
  readonly style = "vector";
  readonly label = "vector";
  private controller: AbortController | null = null;

  constructor(readonly doc = new VectorDocument()) {}

  /** Turning shapes into pixels can't be undone, so it is worth a warning when there are any. */
  get lossyToConvert(): boolean {
    return this.doc.frames.some((frame) => frame.shapes.length > 0);
  }

  reset(width: number, height: number): void {
    this.doc.reset(width, height);
  }

  async export(): Promise<{ file: Blob; sheet: StoredSheet | null }> {
    return { file: new Blob([this.doc.toSvg()], { type: "image/svg+xml" }), sheet: this.doc.sheet };
  }

  mount(mounts: Mounts, report: Report): void {
    this.unmount();
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    const canvas = document.createElement("canvas");
    canvas.id = "sprite";
    mounts.view.replaceChildren(canvas);
    const view = mountVectorCanvas(canvas, this.doc, signal);
    mountVectorTools(mounts.tools, this.doc, view);
    const render = vectorRenderer(this.doc);
    mountFrameStrip(mounts.frames, this.doc, render, report, signal);
    mountAnimationPanel(mounts.animation, this.doc, render, report, signal);
    installVectorShortcuts(this.doc, signal);
  }

  unmount(): void {
    this.controller?.abort();
    this.controller = null;
  }

  /** Paints every frame's shapes into pixels. */
  convert(): Workspace {
    const doc = this.doc;
    doc.cancelDraft();
    const pixel = new PixelWorkspace();
    pixel.doc.openFrames(doc.frames.map(rasterizeFrame), doc.clips, doc.isSheet, doc.name, doc.openedFrom, doc.dirty);
    return pixel;
  }
}
