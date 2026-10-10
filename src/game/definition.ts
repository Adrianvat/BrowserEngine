import { component, type GameDefinition } from "../engine";
import { Player, Velocity } from "./components";
import { playScene } from "./scenes/play";
import playData from "./scenes/play.json";
import { titleScene } from "./scenes/title";
import titleData from "./scenes/title.json";

/** The demo game, shared by the game page and the editor page. */
export const definition: GameDefinition = {
  width: 800,
  height: 600,
  pixelArt: true,
  images: {
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
  },
  components: [
    component(Velocity, "Velocity", { x: "number", y: "number" }),
    component(Player, "Player", {}),
  ],
  scenes: {
    title: { scene: titleScene, data: titleData },
    play: { scene: playScene, data: playData },
  },
  firstScene: "title",
};
