/** Position of an entity's top-left corner, in pixels. */
export class Transform {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

/** Draws the entity as a filled rectangle. */
export class Rect {
  constructor(
    public width: number,
    public height: number,
    public color = "white",
  ) {}
}
