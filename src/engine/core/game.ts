import { World, type System } from "../ecs/world";
import { Keyboard } from "../input/keyboard";
import { Canvas } from "../render/canvas";
import { renderRects } from "../render/systems";
import { advance, FIXED_STEP } from "./timestep";

export interface GameOptions {
  /** A CSS selector like "#game", or the canvas element itself. */
  canvas: string | HTMLCanvasElement;
  width: number;
  height: number;
}

export class Game {
  readonly world = new World();
  private readonly updateSystems: System[] = [];
  private readonly renderSystems: System[] = [renderRects];
  private readonly keyboard = new Keyboard();
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
    this.world.setResource(new Canvas(element, options.width, options.height));
    this.world.setResource(this.keyboard);
  }

  /** Adds a system that runs at a fixed 60 Hz. Systems run in the order added. */
  addSystem(system: System): void {
    this.updateSystems.push(system);
  }

  /** Adds a system that runs once per browser frame, after the built-in rect renderer. */
  addRenderSystem(system: System): void {
    this.renderSystems.push(system);
  }

  start(): void {
    if (this.running) return;
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

  private readonly frame = (now: number): void => {
    const elapsed = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const { steps, accumulator } = advance(this.accumulator, elapsed);
    this.accumulator = accumulator;
    for (let i = 0; i < steps; i++) {
      for (const system of this.updateSystems) system(this.world, FIXED_STEP);
      this.keyboard.endStep();
    }
    for (const system of this.renderSystems) system(this.world, elapsed);

    // A system may have called stop() during this frame.
    if (this.running) this.frameId = requestAnimationFrame(this.frame);
  };
}
