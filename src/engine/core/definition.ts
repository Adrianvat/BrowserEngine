import type { ImageSource } from "../assets/assets";
import type { ComponentDefinition } from "../data/registry";
import type { Scene } from "../scene/scene";

/** A scene's code and its default starting entities (imported JSON, checked at start). */
export interface SceneEntry {
  scene: Scene;
  data: unknown;
}

/** Everything both the game page and the editor page need to know about a game. */
export interface GameDefinition {
  width: number;
  height: number;
  pixelArt?: boolean;
  images: Record<string, ImageSource>;
  /** The game's own editable components; the built-in ones are always registered. */
  components: ComponentDefinition[];
  /** In the order the editor lists them. */
  scenes: Record<string, SceneEntry>;
  firstScene: string;
}
