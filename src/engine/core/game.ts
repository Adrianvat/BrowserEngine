import { animate } from "../animation/animate";
import { Assets } from "../assets/assets";
import { World, type System } from "../ecs/world";
import { Keyboard } from "../input/keyboard";
import { Canvas } from "../render/canvas";
import { render } from "../render/systems";
import { Scenes, type Scene } from "../scene/scene";
import { advance, FIXED_STEP } from "./timestep";

export interface GameOptions {
  /** A CSS selector like "#game", or the canvas element itself. */
  canvas: string | HTMLCanvasElement;
  width: number;
  height: number;
  /** Turn off image smoothing so scaled-up pixel art stays sharp. */
  pixelArt?: boolean;
}

/** The running scene: its world and its systems. */
interface ActiveScene {
  world: World;
  updateSystems: System[];
  renderSystems: System[];
}

export class Game {
  readonly assets = new Assets();
  readonly canvas: Canvas;
  private readonly keyboard = new Keyboard();
  private readonly sceneList = new Map<string, Scene>();
  private readonly scenes = new Scenes((name) => this.sceneList.has(name));
  /** Added to every scene's World; the same objects each time. */
  private readonly globalResources: object[];
  private active: ActiveScene | null = null;
  private running = false;
  private frameId = 0;
  private lastTime = 0;
  private accumulator = 0;

  constructor(options: GameOptions) {
    const element =
      typeof options.canvas === "string"
        ? document.querySelector(options.canvas)
        : options.canvas;
    if (!(element instanceof HTMLCanvasElement)) {
      throw new Error(`Canvas element not found: ${String(options.canvas)}`);
    }
    this.canvas = new Canvas(element, options.width, options.height);
    this.canvas.ctx.imageSmoothingEnabled = !options.pixelArt;
    this.globalResources = [this.canvas, this.assets, this.keyboard, this.scenes];
  }

  /** The running scene's World. */
  get world(): World {
    return this.scene.world;
  }

  addScene(name: string, scene: Scene): void {
    if (this.sceneList.has(name)) throw new Error(`Scene "${name}" is already added`);
    this.sceneList.set(name, scene);
  }

  /** Adds a resource to every scene's World (and to the running one, if any). */
  addGlobalResource(resource: object): void {
    this.globalResources.push(resource);
    this.active?.world.setResource(resource);
  }

  /** Starts the loop with a fresh instance of the named scene. */
  start(sceneName: string): void {
    if (this.running) return;
    this.enterScene(sceneName);
    this.running = true;
    this.keyboard.attach(window);
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.keyboard.detach();
  }

  private get scene(): ActiveScene {
    if (!this.active) throw new Error("No scene is running");
    return this.active;
  }

  /** Replaces the running scene with a fresh instance of the named one. */
  private enterScene(name: string): void {
    const scene = this.sceneList.get(name);
    if (!scene) throw new Error(`Scene "${name}" not found`);
    const world = new World();
    for (const resource of this.globalResources) world.setResource(resource);
    const active: ActiveScene = { world, updateSystems: [], renderSystems: [render] };
    this.active = active;
    this.scenes.enter(name);
    scene.setup({
      world,
      addSystem: (system) => {
        active.updateSystems.push(system);
      },
      addRenderSystem: (system) => {
        active.renderSystems.push(system);
      },
    });
  }

  private readonly frame = (now: number): void => {
    // Cleared so we can tell whether a system restarted the loop during this frame.
    this.frameId = 0;
    // The first frame's timestamp can be slightly earlier than start()'s performance.now().
    const elapsed = Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const { steps, accumulator } = advance(this.accumulator, elapsed);
    this.accumulator = accumulator;
    for (let i = 0; i < steps; i++) {
      const active = this.scene;
      for (const system of active.updateSystems) {
        system(active.world, FIXED_STEP);
        // A system restarted the game with a new scene: the old one's step ends here.
        if (this.active !== active) break;
      }
      // After the scene's systems, so a play() call shows its clip in the same step.
      if (this.active === active) animate(active.world, FIXED_STEP);
      this.keyboard.endStep();
      // Switching last means no system ever runs on a world that was just dropped.
      const next = this.scenes.takeRequest();
      if (next !== null) this.enterScene(next);
    }
    const { world, renderSystems } = this.scene;
    for (const system of renderSystems) system(world, elapsed);

    // A system may have called stop() (and maybe start(), which already scheduled a frame).
    if (this.running && this.frameId === 0) this.frameId = requestAnimationFrame(this.frame);
  };
}
