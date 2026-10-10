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

export interface SpriteOptions {
  /** Frame of a sprite sheet to show. Defaults to 0. */
  frame?: number;
  /** Drawn size in pixels. Defaults to the frame's own size. */
  width?: number;
  height?: number;
  /** Mirror the sprite. Its top-left corner stays at the Transform. */
  flipX?: boolean;
  flipY?: boolean;
}

/** Draws an image (or one frame of a sprite sheet) loaded through Assets. */
export class Sprite {
  frame: number;
  width?: number;
  height?: number;
  flipX: boolean;
  flipY: boolean;

  constructor(
    public image: string,
    options: SpriteOptions = {},
  ) {
    this.frame = options.frame ?? 0;
    this.width = options.width;
    this.height = options.height;
    this.flipX = options.flipX ?? false;
    this.flipY = options.flipY ?? false;
  }
}

/** Draw order: lower layers are drawn first. Entities without a Layer are on 0. */
export class Layer {
  constructor(public value = 0) {}
}

export type TextAlign = "left" | "center" | "right";

export interface TextOptions {
  /** Font size in pixels. Defaults to 16. */
  size?: number;
  /** CSS color. Defaults to "white". */
  color?: string;
  /** CSS font family. Defaults to "sans-serif". */
  font?: string;
  /** Whether the Transform's x is the text's left edge, center, or right edge. Defaults to "left". */
  align?: TextAlign;
}

/** Draws one line of text; the Transform is the top of the text. */
export class Text {
  size: number;
  color: string;
  font: string;
  align: TextAlign;

  constructor(
    public value: string,
    options: TextOptions = {},
  ) {
    this.size = options.size ?? 16;
    this.color = options.color ?? "white";
    this.font = options.font ?? "sans-serif";
    this.align = options.align ?? "left";
  }
}
