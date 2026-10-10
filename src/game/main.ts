import { Game } from "../engine";
import { drawError } from "./errors";
import { playScene } from "./scenes/play";

const game = new Game({ canvas: "#game", width: 800, height: 600, pixelArt: true });

try {
  await game.assets.loadImages({
    background: "/background.svg",
    hero: {
      url: "/hero.svg",
      frameWidth: 16,
      frameHeight: 16,
      animations: {
        idle: { frames: [0, 1], fps: 2 },
        walk: { frames: [2, 3, 4, 5], fps: 8 },
      },
    },
  });
} catch (error) {
  drawError(game.canvas, error);
  throw error;
}

game.addScene("play", playScene);
game.start("play");
