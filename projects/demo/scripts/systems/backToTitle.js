import { Keyboard, Scenes } from "engine";

export const scenes = ["play"];

/** Returns to the title screen when Escape is pressed. */
export default function backToTitle(world) {
  if (world.getResource(Keyboard).wasPressed("Escape")) {
    world.getResource(Scenes).switchTo("title");
  }
}
