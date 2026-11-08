import { findByName, Text } from "engine";
import { plays } from "scenes/play";

/** The title screen. Its entities come from title.json; the startOnEnter script handles Enter. */
export default function setup(scene) {
  const { world } = scene;
  // The label may have been removed in the editor.
  const label = findByName(world, "Plays label");
  const text = label === undefined ? undefined : world.get(label, Text);
  if (text) text.value = `Games played: ${plays.count}`;
}
