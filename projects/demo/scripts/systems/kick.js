import { Body, Collider, Keyboard } from "engine";

export const scenes = ["play"];

/** The upward impulse a kick gives every toy: the lighter it is, the higher it flies. */
export const KICK_IMPULSE = 400;

/** Kicks everything on the "toy" layer upward when Space is pressed. */
export default function kick(world) {
  if (!world.getResource(Keyboard).wasPressed("Space")) return;
  for (const [, collider, body] of world.query(Collider, Body)) {
    if (collider.layer === "toy") body.applyImpulse(0, -KICK_IMPULSE);
  }
}
