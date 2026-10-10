import { Canvas, Keyboard, Rect, Scenes, Transform, type Scene, type World } from "../../engine";
import { Velocity } from "../components";
import { Plays } from "../resources";
import { bounce, clampPlayer, movement, playerAppearance, playerInput } from "../systems";

/** Returns to the title screen when Escape is pressed. */
export function backToTitle(world: World): void {
  if (world.getResource(Keyboard).wasPressed("Escape")) {
    world.getResource(Scenes).switchTo("title");
  }
}

/** The hero walking around among bouncing rects. The hero and the hint come from play.json. */
export const playScene: Scene = {
  setup(scene) {
    const { world } = scene;
    const { width, height } = world.getResource(Canvas);
    world.getResource(Plays).count++;

    // Random every time, so these stay in code.
    for (let i = 0; i < 10; i++) {
      const size = 12 + Math.random() * 24;
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 160;
      const e = world.spawn();
      world.add(e, new Transform(Math.random() * (width - size), Math.random() * (height - size)));
      world.add(e, new Rect(size, size, `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`));
      world.add(e, new Velocity(Math.cos(angle) * speed, Math.sin(angle) * speed));
    }

    scene.addSystem(playerInput);
    scene.addSystem(movement);
    scene.addSystem(bounce);
    scene.addSystem(clampPlayer);
    scene.addSystem(playerAppearance);
    scene.addSystem(backToTitle);
  },
};
