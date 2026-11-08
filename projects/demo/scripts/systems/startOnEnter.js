import { Keyboard, Scenes } from "engine";

export const scenes = ["title"];

/** Starts the game when Enter is pressed. */
export default function startOnEnter(world) {
  if (world.getResource(Keyboard).wasPressed("Enter")) {
    world.getResource(Scenes).switchTo("play");
  }
}
