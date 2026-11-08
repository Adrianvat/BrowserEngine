import { sameColor, TRANSPARENT, type Rgba } from "./color";

/** The largest sprite the editor makes, on each side. */
export const MAX_SIZE = 512;

/** A rectangle of pixels, in sprite coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of `rect` inside a `width` x `height` sprite; null when none of it is. */
export function clampRect(rect: Rect, width: number, height: number): Rect | null {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(width, rect.x + rect.width);
  const bottom = Math.min(height, rect.y + rect.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** The rectangle with (x0, y0) and (x1, y1) as opposite corner pixels, whatever their order. */
export function rectBetween(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0) + 1,
    height: Math.abs(y1 - y0) + 1,
  };
}

export function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** Throws unless `width` x `height` is a size the editor can work with (up to `max` on each side). */
export function checkSize(width: number, height: number, max = MAX_SIZE): void {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new Error("Width and height must be whole numbers of at least 1");
  }
  if (width > max || height > max) {
    throw new Error(`Width and height can be at most ${max}`);
  }
}

/**
 * A sprite's pixels: RGBA bytes, row by row, like ImageData. Every change reports
 * whether it made a difference, so callers can skip redraws and empty undo steps.
 */
export class Pixels {
  readonly data: Uint8ClampedArray;

  constructor(
    readonly width: number,
    readonly height: number,
    data?: Uint8ClampedArray,
  ) {
    checkSize(width, height);
    if (data !== undefined && data.length !== width * height * 4) {
      throw new Error(`Expected ${width * height * 4} bytes for ${width}x${height}`);
    }
    this.data = data ?? new Uint8ClampedArray(width * height * 4);
  }

  contains(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Transparent black outside the sprite. */
  get(x: number, y: number): Rgba {
    if (!this.contains(x, y)) return TRANSPARENT;
    const i = (y * this.width + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  /** True when the pixel changed; painting outside the sprite or with the same color doesn't. */
  set(x: number, y: number, color: Rgba): boolean {
    if (!this.contains(x, y) || sameColor(this.get(x, y), color)) return false;
    this.data.set(color, (y * this.width + x) * 4);
    return true;
  }

  clone(): Pixels {
    return new Pixels(this.width, this.height, new Uint8ClampedArray(this.data));
  }

  equals(other: Pixels): boolean {
    if (other.width !== this.width || other.height !== this.height) return false;
    return this.data.every((byte, index) => byte === other.data[index]);
  }

  /** True when every pixel is fully transparent. */
  isBlank(): boolean {
    for (let i = 3; i < this.data.length; i += 4) if (this.data[i] !== 0) return false;
    return true;
  }

  /** The same picture in a new size, anchored at the top-left: cropped, or padded with transparency. */
  resized(width: number, height: number): Pixels {
    const next = new Pixels(width, height);
    const columns = Math.min(width, this.width);
    for (let y = 0; y < Math.min(height, this.height); y++) {
      const from = y * this.width * 4;
      next.data.set(this.data.subarray(from, from + columns * 4), y * width * 4);
    }
    return next;
  }

  /** A copy of the pixels in `rect`, which must lie inside the sprite. */
  region(rect: Rect): Pixels {
    const copy = new Pixels(rect.width, rect.height);
    for (let y = 0; y < rect.height; y++) {
      const from = ((rect.y + y) * this.width + rect.x) * 4;
      copy.data.set(this.data.subarray(from, from + rect.width * 4), y * rect.width * 4);
    }
    return copy;
  }

  /** Makes every pixel in `rect` transparent; parts outside the sprite are ignored. */
  clearRegion(rect: Rect): boolean {
    const inside = clampRect(rect, this.width, this.height);
    if (!inside) return false;
    let changed = false;
    for (let y = inside.y; y < inside.y + inside.height; y++) {
      for (let x = inside.x; x < inside.x + inside.width; x++) {
        if (this.set(x, y, TRANSPARENT)) changed = true;
      }
    }
    return changed;
  }

  /** Draws `source` with its top-left at (x, y); its transparent pixels leave this one's alone. */
  draw(source: Pixels, x: number, y: number): boolean {
    let changed = false;
    for (let sy = 0; sy < source.height; sy++) {
      for (let sx = 0; sx < source.width; sx++) {
        const color = source.get(sx, sy);
        if (color[3] !== 0 && this.set(x + sx, y + sy, color)) changed = true;
      }
    }
    return changed;
  }

  /** The smallest rectangle holding every opaque pixel; null when there are none. */
  bounds(): Rect | null {
    let left = this.width;
    let top = this.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.data[(y * this.width + x) * 4 + 3] === 0) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right < 0) return null;
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }

  /**
   * Paints a `size` x `size` square of `color` with (x, y) at its center (for even sizes,
   * just up and left of the center). A transparent color erases.
   */
  stamp(x: number, y: number, size: number, color: Rgba): boolean {
    const offset = Math.floor((size - 1) / 2);
    let changed = false;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (this.set(x - offset + dx, y - offset + dy, color)) changed = true;
      }
    }
    return changed;
  }

  /** Stamps every pixel on the straight line from (x0, y0) to (x1, y1), so fast strokes have no gaps. */
  line(x0: number, y0: number, x1: number, y1: number, size: number, color: Rgba): boolean {
    let changed = false;
    for (const [x, y] of linePoints(x0, y0, x1, y1)) {
      if (this.stamp(x, y, size, color)) changed = true;
    }
    return changed;
  }

  /** Recolors the pixel at (x, y) and every same-colored pixel reachable from it through its sides. */
  fill(x: number, y: number, color: Rgba): boolean {
    if (!this.contains(x, y)) return false;
    const target = this.get(x, y);
    if (sameColor(target, color)) return false;
    const { width, height, data } = this;
    const matches = (index: number) =>
      data[index * 4] === target[0] &&
      data[index * 4 + 1] === target[1] &&
      data[index * 4 + 2] === target[2] &&
      data[index * 4 + 3] === target[3];
    // Pixel indices still to look at; a pixel is recolored when pushed, so it is never pushed twice.
    const stack: number[] = [y * width + x];
    data.set(color, stack[0] * 4);
    while (stack.length > 0) {
      const index = stack.pop()!;
      const px = index % width;
      const py = (index - px) / width;
      for (const next of [
        px > 0 ? index - 1 : -1,
        px < width - 1 ? index + 1 : -1,
        py > 0 ? index - width : -1,
        py < height - 1 ? index + width : -1,
      ]) {
        if (next >= 0 && matches(next)) {
          data.set(color, next * 4);
          stack.push(next);
        }
      }
    }
    return true;
  }
}

/** The whole pixels on the line from (x0, y0) to (x1, y1), both ends included (Bresenham). */
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) return points;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
}
