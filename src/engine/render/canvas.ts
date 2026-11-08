/** The game's drawing surface, stored as a World resource. */
export class Canvas {
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly element: HTMLCanvasElement,
    readonly width: number,
    readonly height: number,
  ) {
    element.width = width;
    element.height = height;
    const ctx = element.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context is not available");
    this.ctx = ctx;
  }
}
