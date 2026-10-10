import type { Canvas } from "../engine";

const LINE_HEIGHT = 24;
const MARGIN = 16;
/** Approximate width of one character of 16px monospace text. */
const CHAR_WIDTH = 10;

/** Shows an error on the canvas, so a failed start isn't just a blank screen. */
export function drawError(canvas: Canvas, error: unknown): void {
  const { ctx, width, height } = canvas;
  const message = error instanceof Error ? error.message : String(error);
  const charsPerLine = Math.max(1, Math.floor((width - 2 * MARGIN) / CHAR_WIDTH));

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f87171";
  ctx.font = "16px monospace";
  // The game may have left other text settings behind (e.g. centered titles).
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Failed to start:", MARGIN, 32);
  for (let i = 0; i * charsPerLine < message.length; i++) {
    const line = message.slice(i * charsPerLine, (i + 1) * charsPerLine);
    ctx.fillText(line, MARGIN, 32 + (i + 1) * LINE_HEIGHT);
  }
}
