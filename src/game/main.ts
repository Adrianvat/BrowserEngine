import { browserSceneStore, Game } from "../engine";
import { definition } from "./definition";
import { drawError } from "./errors";
import { Plays } from "./resources";

const game = new Game({
  canvas: "#game",
  width: definition.width,
  height: definition.height,
  pixelArt: definition.pixelArt,
  components: definition.components,
  sceneStore: browserSceneStore(),
  // E.g. an Animator clip or sprite frame set in the editor that doesn't exist.
  onError: (error) => {
    drawError(game.canvas, error);
    console.error(error);
  },
});

try {
  await game.assets.loadImages(definition.images);
  game.addGlobalResource(new Plays());
  for (const [name, { scene, data }] of Object.entries(definition.scenes)) {
    game.addScene(name, scene, data);
  }
  game.start(definition.firstScene);
} catch (error) {
  drawError(game.canvas, error);
  throw error;
}
