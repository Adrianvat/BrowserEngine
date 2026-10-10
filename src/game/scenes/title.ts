import { findByName, Keyboard, Scenes, Text, type Scene, type World } from "../../engine";
import { Plays } from "../resources";

/** Starts the game when Enter is pressed. */
export function startOnEnter(world: World): void {
  if (world.getResource(Keyboard).wasPressed("Enter")) {
    world.getResource(Scenes).switchTo("play");
  }
}

/** The title screen. Its entities come from title.json. */
export const titleScene: Scene = {
  setup(scene) {
    const { world } = scene;
    // The label may have been removed in the editor.
    const label = findByName(world, "Plays label");
    const text = label === undefined ? undefined : world.get(label, Text);
    if (text) text.value = `Games played: ${world.getResource(Plays).count}`;

    scene.addSystem(startOnEnter);
  },
};
