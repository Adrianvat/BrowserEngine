import type { World } from "../ecs/world";
import { Canvas } from "./canvas";
import { Rect, Transform } from "./components";

/** Built-in render system: clears the canvas and draws every Transform + Rect. */
export function renderRects(world: World): void {
  const { ctx, width, height } = world.getResource(Canvas);
  ctx.clearRect(0, 0, width, height);
  for (const [, transform, rect] of world.query(Transform, Rect)) {
    ctx.fillStyle = rect.color;
    ctx.fillRect(transform.x, transform.y, rect.width, rect.height);
  }
}
