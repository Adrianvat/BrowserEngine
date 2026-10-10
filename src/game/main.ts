import { browserImageStore, browserSceneStore, Game, toImageSources } from "../engine";
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
  const stored = await (await browserImageStore()).list();
  await game.assets.loadImages(
    toImageSources(stored, definition.images, (file) => URL.createObjectURL(file)),
  );
  game.addGlobalResource(new Plays());
  for (const [name, { scene, data }] of Object.entries(definition.scenes)) {
    game.addScene(name, scene, data);
  }
  game.start(definition.firstScene);
} catch (error) {
  drawError(game.canvas, error);
  throw error;
}
