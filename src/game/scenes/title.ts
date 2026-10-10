import {
  Canvas,
  Keyboard,
  Layer,
  Scenes,
  Sprite,
  Text,
  Transform,
  type Scene,
  type World,
} from "../../engine";
import { Plays } from "../resources";

/** Starts the game when Enter is pressed. */
export function startOnEnter(world: World): void {
  if (world.getResource(Keyboard).wasPressed("Enter")) {
    world.getResource(Scenes).switchTo("play");
  }
}

/** The title screen: a prompt and the number of games played so far. */
export const titleScene: Scene = {
  setup(scene) {
    const { world } = scene;
    const { width, height } = world.getResource(Canvas);

    const background = world.spawn();
    world.add(background, new Transform(0, 0));
    world.add(background, new Sprite("background"));
    world.add(background, new Layer(-1));

    const prompt = world.spawn();
    world.add(prompt, new Transform(width / 2, height / 2 - 40));
    world.add(prompt, new Text("Press Enter to start", { size: 32, align: "center" }));

    const plays = world.spawn();
    world.add(plays, new Transform(width / 2, height / 2 + 10));
    world.add(
      plays,
      new Text(`Games played: ${world.getResource(Plays).count}`, {
        size: 20,
        color: "#cbd5e1",
        align: "center",
      }),
    );

    scene.addSystem(startOnEnter);
  },
};
