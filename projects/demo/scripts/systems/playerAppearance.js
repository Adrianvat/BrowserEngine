import { Animator, Sprite, Velocity } from "engine";
import Player from "components/Player";

export const scenes = ["play"];

/** Picks the player's animation and facing from its velocity. */
export default function playerAppearance(world) {
  for (const [, , velocity, sprite, animator] of world.query(Player, Velocity, Sprite, Animator)) {
    const moving = velocity.x !== 0 || velocity.y !== 0;
    animator.play(moving ? "walk" : "idle");
    if (velocity.x < 0) sprite.flipX = true;
    else if (velocity.x > 0) sprite.flipX = false;
  }
}
