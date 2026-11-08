import { Collider, Contacts } from "engine";
import Player from "components/Player";

export const scenes = ["play"];

/** Pops (removes) everything on the "toy" layer the player touched this step. Runs after physics. */
export default function popToys(world) {
  const contacts = world.getResource(Contacts);
  for (const [player] of world.query(Player)) {
    for (const { other } of contacts.of(player)) {
      if (world.get(other, Collider)?.layer === "toy") world.despawn(other);
    }
  }
}
