import {
  Layer,
  Rect,
  Sprite,
  Text,
  Transform,
  type Assets,
  type Entity,
  type World,
} from "../engine";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Measures a Text's width in pixels (the canvas's measureText in the browser). */
export type MeasureText = (text: Text) => number;

/** Size of the cross drawn for an entity that has nothing else to draw. */
export const MARKER_SIZE = 9;

export function hasDrawable(world: World, entity: Entity): boolean {
  return world.has(entity, Rect) || world.has(entity, Sprite) || world.has(entity, Text);
}

/** The area an entity covers on screen: everything it draws, or its marker. Null without a Transform. */
export function entityBox(
  world: World,
  entity: Entity,
  assets: Assets,
  measure: MeasureText,
): Box | null {
  const transform = world.get(entity, Transform);
  if (!transform) return null;
  const { x, y } = transform;
  const boxes: Box[] = [];

  const rect = world.get(entity, Rect);
  if (rect) boxes.push({ x, y, width: rect.width, height: rect.height });

  const sprite = world.get(entity, Sprite);
  if (sprite && canDraw(assets, sprite)) {
    const { sw, sh } = assets.getFrame(sprite.image, sprite.frame);
    boxes.push({ x, y, width: sprite.width ?? sw, height: sprite.height ?? sh });
  }

  const text = world.get(entity, Text);
  if (text) {
    const width = measure(text);
    const left = text.align === "center" ? x - width / 2 : text.align === "right" ? x - width : x;
    boxes.push({ x: left, y, width, height: text.size });
  }

  if (boxes.length === 0) {
    const half = MARKER_SIZE / 2;
    return { x: x - half, y: y - half, width: MARKER_SIZE, height: MARKER_SIZE };
  }
  return union(boxes);
}

/** The top-most entity whose box contains the point, in the renderer's order. */
export function hitTest(
  world: World,
  point: { x: number; y: number },
  assets: Assets,
  measure: MeasureText,
): Entity | null {
  const entities = world.query(Transform).map(([entity]) => entity);
  // Drawn last = on top: highest layer, then latest spawned.
  entities.sort((a, b) => layerOf(world, b) - layerOf(world, a) || b - a);
  for (const entity of entities) {
    const box = entityBox(world, entity, assets, measure);
    if (
      box &&
      point.x >= box.x &&
      point.x < box.x + box.width &&
      point.y >= box.y &&
      point.y < box.y + box.height
    ) {
      return entity;
    }
  }
  return null;
}

function layerOf(world: World, entity: Entity): number {
  return world.get(entity, Layer)?.value ?? 0;
}

function canDraw(assets: Assets, sprite: Sprite): boolean {
  if (!assets.hasImage(sprite.image)) return false;
  const { frame } = sprite;
  return Number.isInteger(frame) && frame >= 0 && frame < assets.frameCount(sprite.image);
}

function union(boxes: Box[]): Box {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
