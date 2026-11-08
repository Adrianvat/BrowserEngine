import { Keyboard, Velocity } from "engine";
import Player from "components/Player";

export const scenes = ["play"];

/** Pixels per second the hero walks at. */
export const PLAYER_SPEED = 300;

/** Steers every Player's Velocity with the arrow keys or WASD. */
export default function playerInput(world) {
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
