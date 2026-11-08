import type { FramesDocument } from "../frames-document";

/** Draws frame `index` of a document at `scale` into a context (made by the style's workspace). */
export type FrameRenderer = (ctx: CanvasRenderingContext2D, index: number, scale: number) => void;

/** Thumbnails are scaled to fit this many CSS pixels on each side. */
const THUMB_SIZE = 56;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = text;
  element.title = title;
  element.addEventListener("click", onClick);
  return element;
}

/** Draws a frame scaled to fit the thumbnail. */
function drawThumbnail(
  canvas: HTMLCanvasElement,
  doc: FramesDocument<unknown>,
  index: number,
  render: FrameRenderer,
): void {
  const scale = Math.min(THUMB_SIZE / doc.width, THUMB_SIZE / doc.height);
  const width = Math.max(1, Math.round(doc.width * scale));
  const height = Math.max(1, Math.round(doc.height * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  render(ctx, index, scale);
}

/**
 * Every frame as a numbered thumbnail (click to edit it), with add, duplicate, remove
 * and reorder. Stops listening when `signal` aborts.
 */
export function mountFrameStrip(
  root: HTMLElement,
  doc: FramesDocument<unknown>,
  render: FrameRenderer,
  report: (message: string, kind?: "" | "error") => void,
  signal: AbortSignal,
): void {
  const attempt = (action: () => void) => {
    try {
      action();
      report("");
    } catch (error) {
      report(messageOf(error), "error");
    }
  };

  const controls = document.createElement("div");
  controls.className = "frame-controls";
  const add = button("+ Frame", "Add a blank frame after this one", () => attempt(() => doc.addFrame()));
  const duplicate = button("Duplicate", "Add a copy of this frame after it", () =>
    attempt(() => doc.duplicateFrame()),
  );
  const remove = button("Remove", "Remove this frame", () => attempt(() => doc.removeFrame()));
  const left = button("◀", "Move this frame earlier", () => doc.moveFrame(-1));
  const right = button("▶", "Move this frame later", () => doc.moveFrame(1));
  const label = document.createElement("span");
  label.className = "frame-label";
  controls.append(add, duplicate, remove, left, right, label);

  const list = document.createElement("div");
  list.className = "frame-list";
  const thumbnails: HTMLCanvasElement[] = [];
  /** The frame each thumbnail last drew, so unchanged frames aren't redrawn. */
  const drawn = new WeakMap<HTMLCanvasElement, unknown>();

  root.replaceChildren(controls, list);

  const rebuild = () => {
    list.replaceChildren();
    thumbnails.length = 0;
    doc.frames.forEach((_, index) => {
      const item = document.createElement("div");
      item.className = "frame";
      const canvas = document.createElement("canvas");
      const number = document.createElement("span");
      number.textContent = String(index);
      item.append(canvas, number);
      item.addEventListener("click", () => doc.setFrame(index));
      thumbnails.push(canvas);
      list.append(item);
    });
  };

  let frame = 0;
  let size = "";
  const update = () => {
    frame = 0;
    if (signal.aborted) return;
    if (thumbnails.length !== doc.frameCount) rebuild();
    const nextSize = `${doc.width}x${doc.height}`;
    const resized = nextSize !== size;
    size = nextSize;
    doc.frames.forEach((frameData, index) => {
      const canvas = thumbnails[index];
      const current = index === doc.frame;
      // The current frame may change in place while drawing, so it is always redrawn.
      if (current || resized || drawn.get(canvas) !== frameData) {
        drawThumbnail(canvas, doc, index, render);
        drawn.set(canvas, frameData);
      }
      canvas.parentElement?.classList.toggle("selected", current);
    });
    remove.disabled = doc.frameCount === 1;
    left.disabled = doc.frame === 0;
    right.disabled = doc.frame === doc.frameCount - 1;
    label.textContent = `Frame ${doc.frame} of ${doc.frameCount}`;
    thumbnails[doc.frame]?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  /** Redraws once per animation frame however many changes arrive. */
  doc.onChange(() => {
    if (frame === 0 && !signal.aborted) frame = requestAnimationFrame(update);
  });
  update();
}
