import { Game, Layer, Rect, Sprite, Transform } from "../engine";
import { Player, Velocity } from "./components";
import { bounce, clampPlayer, movement, playerAppearance, playerInput } from "./systems";

const WIDTH = 800;
const HEIGHT = 600;
const PLAYER_SIZE = 32;

const game = new Game({ canvas: "#game", width: WIDTH, height: HEIGHT, pixelArt: true });
const world = game.world;

await game.assets.loadImages({
  background: "/background.svg",
  hero: { url: "/hero.svg", frameWidth: 16, frameHeight: 16 },
});

const background = world.spawn();
world.add(background, new Transform(0, 0));
world.add(background, new Sprite("background"));
world.add(background, new Layer(-1));

const player = world.spawn();
world.add(player, new Player());
world.add(player, new Transform((WIDTH - PLAYER_SIZE) / 2, (HEIGHT - PLAYER_SIZE) / 2));
world.add(player, new Sprite("hero", { width: PLAYER_SIZE, height: PLAYER_SIZE }));
world.add(player, new Layer(1));
world.add(player, new Velocity());

for (let i = 0; i < 10; i++) {
  const size = 12 + Math.random() * 24;
  const angle = Math.random() * Math.PI * 2;
  const speed = 80 + Math.random() * 160;
  const e = world.spawn();
  world.add(e, new Transform(Math.random() * (WIDTH - size), Math.random() * (HEIGHT - size)));
  world.add(e, new Rect(size, size, `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`));
  world.add(e, new Velocity(Math.cos(angle) * speed, Math.sin(angle) * speed));
}

game.addSystem(playerInput);
game.addSystem(movement);
game.addSystem(bounce);
game.addSystem(clampPlayer);
game.addSystem(playerAppearance);
game.start();
