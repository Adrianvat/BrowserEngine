import { Animator, Canvas, Layer, Rect, Sprite, Transform, type Scene } from "../../engine";
import { Player, Velocity } from "../components";
import { bounce, clampPlayer, movement, playerAppearance, playerInput } from "../systems";

const PLAYER_SIZE = 32;

/** The hero walking around among bouncing rects. */
export const playScene: Scene = {
  setup(scene) {
    const { world } = scene;
    const { width, height } = world.getResource(Canvas);

    const background = world.spawn();
    world.add(background, new Transform(0, 0));
    world.add(background, new Sprite("background"));
    world.add(background, new Layer(-1));

    const player = world.spawn();
    world.add(player, new Player());
    world.add(player, new Transform((width - PLAYER_SIZE) / 2, (height - PLAYER_SIZE) / 2));
    world.add(player, new Sprite("hero", { width: PLAYER_SIZE, height: PLAYER_SIZE }));
    world.add(player, new Layer(1));
    world.add(player, new Velocity());
    world.add(player, new Animator("idle"));

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
  },
};
