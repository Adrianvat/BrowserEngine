import { Assets } from "../assets/assets";
import type { Entity, World } from "../ecs/world";
import { Canvas } from "./canvas";
import { Layer, Rect, Sprite, Transform } from "./components";

interface DrawItem {
  layer: number;
  entity: Entity;
  draw: () => void;
}

/**
 * Built-in render system: clears the canvas, then draws every Rect and Sprite
 * by layer, then spawn order.
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

  // sort() is stable and rects were added first, so an entity's rect is drawn under its sprite.
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
