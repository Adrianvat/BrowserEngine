import { Assets } from "../assets/assets";
import type { Entity, World } from "../ecs/world";
import { Canvas } from "./canvas";
import { Layer, Rect, Sprite, Text, Transform } from "./components";

interface DrawItem {
  layer: number;
  entity: Entity;
  draw: () => void;
}

/**
 * Built-in render system: clears the canvas, then draws every Rect, Sprite
 * and Text by layer, then spawn order.
 */
export function render(world: World): void {
  const { ctx, width, height } = world.getResource(Canvas);
  ctx.clearRect(0, 0, width, height);

  const items: DrawItem[] = [];
  for (const [entity, transform, rect] of world.query(Transform, Rect)) {
    items.push({
      layer: layerOf(world, entity),
      entity,
      draw: () => {
        ctx.fillStyle = rect.color;
        ctx.fillRect(transform.x, transform.y, rect.width, rect.height);
      },
    });
  }

  const sprites = world.query(Transform, Sprite);
  if (sprites.length > 0) {
    const assets = world.getResource(Assets);
    for (const [entity, transform, sprite] of sprites) {
      items.push({
        layer: layerOf(world, entity),
        entity,
        draw: () => drawSprite(ctx, assets, transform, sprite),
      });
    }
  }

  for (const [entity, transform, text] of world.query(Transform, Text)) {
    items.push({
      layer: layerOf(world, entity),
      entity,
      draw: () => drawText(ctx, transform, text),
    });
  }

  // sort() is stable and items were added rects, then sprites, then text, so within
  // one entity the text is on top of its sprite, which is on top of its rect.
  items.sort((a, b) => a.layer - b.layer || a.entity - b.entity);
  for (const item of items) item.draw();
}

function layerOf(world: World, entity: Entity): number {
  return world.get(entity, Layer)?.value ?? 0;
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  transform: Transform,
  sprite: Sprite,
): void {
  const image = assets.getImage(sprite.image);
  const { sx, sy, sw, sh } = assets.getFrame(sprite.image, sprite.frame);
  const w = sprite.width ?? sw;
  const h = sprite.height ?? sh;

  if (!sprite.flipX && !sprite.flipY) {
    ctx.drawImage(image, sx, sy, sw, sh, transform.x, transform.y, w, h);
    return;
  }
  // Mirror around the sprite's own box so its top-left corner stays put.
  ctx.save();
  ctx.translate(transform.x + (sprite.flipX ? w : 0), transform.y + (sprite.flipY ? h : 0));
  ctx.scale(sprite.flipX ? -1 : 1, sprite.flipY ? -1 : 1);
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, transform: Transform, text: Text): void {
  ctx.font = `${text.size}px ${text.font}`;
  ctx.fillStyle = text.color;
  ctx.textAlign = text.align;
  ctx.textBaseline = "top";
  ctx.fillText(text.value, transform.x, transform.y);
}
