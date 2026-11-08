interface Point {
  x: number;
  y: number;
}

/** One drag of an entity in the viewport, in scene pixels. */
export class Drag {
  private position: Point;

  constructor(
    /** Index of the dragged entity in the scene data. */
    readonly index: number,
    /** Pointer position at the press. */
    private readonly start: Point,
    /** The entity's position at the press. */
    private readonly from: Point,
  ) {
    this.position = { ...from };
  }

  /** The entity's position for this pointer position, in whole pixels. */
  to(pointer: Point): Point {
    this.position = {
      x: Math.round(this.from.x + pointer.x - this.start.x),
      y: Math.round(this.from.y + pointer.y - this.start.y),
    };
    return this.position;
  }

  /** The position to save, or null when the entity ends where it started (e.g. a plain click). */
  end(): Point | null {
    const { x, y } = this.position;
    return x === this.from.x && y === this.from.y ? null : this.position;
  }

  /** False once the entity is no longer selected (e.g. deleted mid-drag). */
  stillValid(selected: number | null): boolean {
    return selected === this.index;
  }
}
