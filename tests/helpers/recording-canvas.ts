import { Canvas } from "../../src/engine/render/canvas";

export type Call = [string, ...unknown[]];

/** One fillText call together with the text state it was drawn with. */
export interface TextDraw {
  value: unknown;
  x: unknown;
  y: unknown;
  font: string;
  fillStyle: string;
  textAlign: string;
  textBaseline: string;
}

/** Stands in for CanvasRenderingContext2D and records every drawing call. */
class RecordingContext {
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  font = "";
  textAlign = "start";
  textBaseline = "alphabetic";
  imageSmoothingEnabled = true;
  readonly calls: Call[] = [];
  readonly texts: TextDraw[] = [];

  clearRect(...args: unknown[]): void {
    this.calls.push(["clearRect", ...args]);
  }
  fillRect(...args: unknown[]): void {
    this.calls.push(["fillRect", this.fillStyle, ...args]);
  }
  fillText(value: unknown, x: unknown, y: unknown): void {
    this.calls.push(["fillText", value, x, y]);
    const { font, fillStyle, textAlign, textBaseline } = this;
    this.texts.push({ value, x, y, font, fillStyle, textAlign, textBaseline });
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
  setTransform(...args: unknown[]): void {
    this.calls.push(["setTransform", ...args]);
  }
  beginPath(): void {
    this.calls.push(["beginPath"]);
  }
  closePath(): void {
    this.calls.push(["closePath"]);
  }
  arc(...args: unknown[]): void {
    this.calls.push(["arc", ...args]);
  }
  fill(): void {
    this.calls.push(["fill", this.fillStyle]);
  }
  moveTo(...args: unknown[]): void {
    this.calls.push(["moveTo", ...args]);
  }
  lineTo(...args: unknown[]): void {
    this.calls.push(["lineTo", ...args]);
  }
  stroke(): void {
    this.calls.push(["stroke", this.strokeStyle]);
  }
  setLineDash(segments: unknown): void {
    this.calls.push(["setLineDash", segments]);
  }
}

/** A real Canvas resource backed by a recording context instead of a browser canvas. */
export function recordingCanvas(
  width = 100,
  height = 100,
): { canvas: Canvas; calls: Call[]; texts: TextDraw[] } {
  const ctx = new RecordingContext();
  const element = { width: 0, height: 0, getContext: () => ctx };
  return {
    canvas: new Canvas(element as unknown as HTMLCanvasElement, width, height),
    calls: ctx.calls,
    texts: ctx.texts,
  };
}
