import { Game, Rect, Transform } from "../engine";
import { Player, Velocity } from "./components";
import { bounce, movement, playerInput } from "./systems";

const WIDTH = 800;
const HEIGHT = 600;
const PLAYER_SIZE = 32;

const game = new Game({ canvas: "#game", width: WIDTH, height: HEIGHT });
const world = game.world;

const player = world.spawn();
world.add(player, new Player());
world.add(player, new Transform((WIDTH - PLAYER_SIZE) / 2, (HEIGHT - PLAYER_SIZE) / 2));
world.add(player, new Rect(PLAYER_SIZE, PLAYER_SIZE, "#4ade80"));
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
game.start();
