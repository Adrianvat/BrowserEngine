import { Assets } from "../assets/assets";
import type { World } from "../ecs/world";
import { Sprite } from "../render/components";
import { Animator } from "./animator";

/** Keeps float rounding (e.g. six 1/60 s steps at 10 fps) from landing just short of a frame. */
const EPSILON = 1e-9;

/** Advances every Animator and sets its Sprite's frame. Runs once per fixed step. */
export function animate(world: World, dt: number): void {
  const rows = world.query(Sprite, Animator);
  if (rows.length === 0) return;
  const assets = world.getResource(Assets);

  for (const [, sprite, animator] of rows) {
    const clip = assets.getAnimation(sprite.image, animator.clip);
    const count = clip.frames.length;
    animator.time += dt;
    let position = Math.floor(animator.time * clip.fps + EPSILON);

    if (clip.loop) {
      const cycles = Math.floor(position / count);
      if (cycles > 0) {
        position -= cycles * count;
        animator.time = Math.max(0, animator.time - (cycles * count) / clip.fps);
      }
    } else if (position >= count) {
      position = count - 1;
      animator.finished = true;
    }

    sprite.frame = clip.frames[position];
  }
}
