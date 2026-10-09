import { Canvas } from "../../src/engine/render/canvas";

export type Call = [string, ...unknown[]];

/** Stands in for CanvasRenderingContext2D and records every drawing call. */
class RecordingContext {
  fillStyle = "";
  imageSmoothingEnabled = true;
  readonly calls: Call[] = [];

  clearRect(...args: unknown[]): void {
    this.calls.push(["clearRect", ...args]);
  }
  fillRect(...args: unknown[]): void {
    this.calls.push(["fillRect", this.fillStyle, ...args]);
  }
  drawImage(...args: unknown[]): void {
    this.calls.push(["drawImage", ...args]);
  }
  save(): void {
    this.calls.push(["save"]);
  }
  restore(): void {
    this.calls.push(["restore"]);
  }
  translate(...args: unknown[]): void {
    this.calls.push(["translate", ...args]);
  }
  scale(...args: unknown[]): void {
    this.calls.push(["scale", ...args]);
  }
}

/** A real Canvas resource backed by a recording context instead of a browser canvas. */
export function recordingCanvas(width = 100, height = 100): { canvas: Canvas; calls: Call[] } {
  const ctx = new RecordingContext();
  const element = { width: 0, height: 0, getContext: () => ctx };
  return {
    canvas: new Canvas(element as unknown as HTMLCanvasElement, width, height),
    calls: ctx.calls,
  };
}
