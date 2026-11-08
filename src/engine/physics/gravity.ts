/**
 * The acceleration every Body feels, in pixels per second squared. Positive y is
 * down, like the canvas. A global resource, present in every scene's World; a
 * scene can set its own with `world.setResource(new Gravity(...))`.
 */
export class Gravity {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}
