import { Canvas, Keyboard, Rect, Transform, type World } from "../engine";
import { Player, Velocity } from "./components";

export const PLAYER_SPEED = 300;

export function playerInput(world: World): void {
  const keyboard = world.getResource(Keyboard);
  for (const [, , velocity] of world.query(Player, Velocity)) {
    let dx = 0;
    let dy = 0;
    if (keyboard.isDown("ArrowLeft") || keyboard.isDown("KeyA")) dx -= 1;
    if (keyboard.isDown("ArrowRight") || keyboard.isDown("KeyD")) dx += 1;
    if (keyboard.isDown("ArrowUp") || keyboard.isDown("KeyW")) dy -= 1;
    if (keyboard.isDown("ArrowDown") || keyboard.isDown("KeyS")) dy += 1;
    velocity.x = dx * PLAYER_SPEED;
    velocity.y = dy * PLAYER_SPEED;
  }
}

export function movement(world: World, dt: number): void {
  for (const [, transform, velocity] of world.query(Transform, Velocity)) {
    transform.x += velocity.x * dt;
    transform.y += velocity.y * dt;
  }
}

/** Keeps everything on screen: the player stops at the edges, others bounce. */
export function bounce(world: World): void {
  const { width, height } = world.getResource(Canvas);
  for (const [entity, transform, rect, velocity] of world.query(Transform, Rect, Velocity)) {
    const maxX = width - rect.width;
    const maxY = height - rect.height;

    if (world.has(entity, Player)) {
      transform.x = Math.min(Math.max(transform.x, 0), maxX);
      transform.y = Math.min(Math.max(transform.y, 0), maxY);
      continue;
    }

    if (transform.x < 0) {
      transform.x = 0;
      velocity.x = Math.abs(velocity.x);
    } else if (transform.x > maxX) {
      transform.x = maxX;
      velocity.x = -Math.abs(velocity.x);
    }
    if (transform.y < 0) {
      transform.y = 0;
      velocity.y = Math.abs(velocity.y);
    } else if (transform.y > maxY) {
      transform.y = maxY;
      velocity.y = -Math.abs(velocity.y);
    }
  }
}
