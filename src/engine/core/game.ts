import { animate } from "../animation/animate";
import { Assets } from "../assets/assets";
import { ComponentRegistry, type ComponentDefinition } from "../data/registry";
import { spawnSceneData, validateSceneData, type SceneData } from "../data/scene-data";
import { World } from "../ecs/world";
import { Keyboard } from "../input/keyboard";
import { openPerfChannel, PerfBroadcast, type PerfChannel } from "../perf/broadcast";
import { PerfOverlay, type PerfOverlayOptions } from "../perf/overlay";
import { PerfStats, readHeapBytes, type FrameSample } from "../perf/stats";
import { Contacts } from "../physics/contacts";
import { Gravity } from "../physics/gravity";
import { CollisionLayers, type LayerRules } from "../physics/layers";
import { Canvas } from "../render/canvas";
import { render } from "../render/systems";
import { Scenes, type Scene } from "../scene/scene";
import { Systems } from "../scene/systems";
import { advance, FIXED_STEP } from "./timestep";

export interface GameOptions {
  /** A CSS selector like "#game", or the canvas element itself. */
  canvas: string | HTMLCanvasElement;
  width: number;
  height: number;
  /** Turn off image smoothing so scaled-up pixel art stays sharp. */
  pixelArt?: boolean;
  /** The game's own editable components; the built-in ones are always registered. */
  components?: readonly ComponentDefinition[];
  /**
   * The acceleration every Body feels, in pixels per second squared; positive y is down.
   * Off (0, 0) by default. Systems can change it while the game runs through `game.gravity`.
   */
  gravity?: { x?: number; y?: number };
  /**
   * How Collider layers interact: for each layer, the layers it is solid against (pushed
   * apart and reported as touching) and the ones it only touches (reported, not pushed).
   * Rules go both ways; pairs not listed ignore each other, except that "default" (a new
   * Collider's layer) is solid against anything it is not paired with. Without this, every
   * collider is solid against every other. Also makes a Collider's layer a choice of these
   * names in scene data and the editor.
   */
  collisionLayers?: Readonly<Record<string, LayerRules>>;
  /**
   * The performance overlay: FPS, frame / update / render times with graphs, and more.
   * Hidden until F3 is pressed while the game runs (Shift+F3 switches its layout, Ctrl+F3
   * moves it to the next corner). On by default; `false` leaves it out, e.g. for a release.
   */
  perfOverlay?: boolean | PerfOverlayOptions;
  /**
   * Send every frame's figures to the live performance page (live-perf.html) while one is
   * open in another tab. On by default; `false` leaves it out. A channel can be given to
   * stand in for the BroadcastChannel.
   */
  perfBroadcast?: boolean | PerfChannel;
  /**
   * Called when a system, a scene's setup or its data throws while the game runs.
   * The loop stops first. Without it, the exception propagates (and the loop stops).
   */
  onError?: (error: unknown) => void;
}

/** The running scene: its world and its systems. */
interface ActiveScene {
  world: World;
  systems: Systems;
}

/** A scene added to the game, with its starting data (if any). */
interface AddedScene {
  scene: Scene;
  data: unknown;
}

export class Game {
  readonly assets = new Assets();
  readonly canvas: Canvas;
  /** The components scene data can use. */
  readonly registry: ComponentRegistry;
  /** What the loop measured, refreshed every frame. Also a global resource. */
  readonly perf = new PerfStats();
  /** The gravity Bodies feel, from the `gravity` option. A global resource. */
  readonly gravity: Gravity;
  /** What touched what in the last physics step. A global resource. */
  readonly contacts = new Contacts();
  /** How Collider layers interact, from the `collisionLayers` option. A global resource. */
  readonly collisionLayers: CollisionLayers;
  /** The performance overlay, or null when the game was created with `perfOverlay: false`. */
  readonly perfOverlay: PerfOverlay | null;
  private readonly perfBroadcast: PerfBroadcast | null;
  private readonly onError: ((error: unknown) => void) | null;
  private readonly keyboard = new Keyboard();
  private readonly sceneList = new Map<string, AddedScene>();
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
    this.collisionLayers = new CollisionLayers(options.collisionLayers);
    this.registry = new ComponentRegistry(options.components, this.collisionLayers.names);
    this.gravity = new Gravity(options.gravity?.x ?? 0, options.gravity?.y ?? 0);
    this.onError = options.onError ?? null;
    const overlay = options.perfOverlay ?? true;
    this.perfOverlay = overlay === false ? null : new PerfOverlay(overlay === true ? {} : overlay);
    const broadcast = options.perfBroadcast ?? true;
    this.perfBroadcast =
      broadcast === false
        ? null
        : new PerfBroadcast(broadcast === true ? openPerfChannel() : broadcast);
    this.globalResources = [
      this.canvas,
      this.assets,
      this.keyboard,
      this.scenes,
      this.perf,
      this.gravity,
      this.contacts,
      this.collisionLayers,
    ];
  }

  /** The running scene's World. */
  get world(): World {
    return this.scene.world;
  }

  /**
   * Adds a scene. `data` is its starting entities (scene data, normally the scene's JSON
   * file), spawned before its setup runs; checked when the game starts.
   */
  addScene(name: string, scene: Scene, data?: unknown): void {
    if (this.sceneList.has(name)) throw new Error(`Scene "${name}" is already added`);
    this.sceneList.set(name, { scene, data });
  }

  /** Adds a resource to every scene's World (and to the running one, if any). */
  addGlobalResource(resource: object): void {
    this.globalResources.push(resource);
    this.active?.world.setResource(resource);
  }

  /** Starts the loop with a fresh instance of the named scene. */
  start(sceneName: string): void {
    if (this.running) return;
    // Check every scene's data now, so a broken scene fails before the loop starts.
    for (const [name, added] of this.sceneList) this.sceneData(name, added.data);
    this.enterScene(sceneName);
    this.running = true;
    this.keyboard.attach(window);
    this.perfOverlay?.attach(window);
    this.perf.reset();
    this.perfBroadcast?.start();
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame(this.frame);
  }

  /** Stops the loop; the scene's systems get their onDisable, as if the scene were left. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.keyboard.detach();
    this.perfOverlay?.detach();
    // So a log that was in progress (e.g. when a system threw) is not lost.
    this.perfOverlay?.flushLog();
    this.perfBroadcast?.stop();
    this.active?.systems.stop();
  }

  private get scene(): ActiveScene {
    if (!this.active) throw new Error("No scene is running");
    return this.active;
  }

  /** Replaces the running scene with a fresh instance of the named one. */
  private enterScene(name: string): void {
    const added = this.sceneList.get(name);
    if (!added) throw new Error(`Scene "${name}" not found`);
    // Read before anything changes, so bad data leaves the running scene alone.
    const data = this.sceneData(name, added.data);
    // The old scene's systems stop first (their onDisable sees the old world).
    this.active?.systems.stop();
    const world = new World();
    for (const resource of this.globalResources) world.setResource(resource);
    this.contacts.clear(); // The old scene's touches mean nothing here.
    const systems = new Systems(world);
    world.setResource(systems);
    systems.add(render, "render");
    const active: ActiveScene = { world, systems };
    this.active = active;
    this.scenes.enter(name);
    if (data) spawnSceneData(world, data, this.registry);
    added.scene.setup({
      world,
      addSystem: (system) => systems.add(system, "update"),
      addRenderSystem: (system) => systems.add(system, "render"),
    });
    // Set up: the systems' onEnable see the entities and can add to them.
    systems.start();
  }

  /** The scene's data checked against the registry, or null when it has none. */
  private sceneData(name: string, data: unknown): SceneData | null {
    try {
      return data === undefined ? null : validateSceneData(data, this.registry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Scene "${name}": ${message}`, { cause: error });
    }
  }

  private readonly frame = (now: number): void => {
    try {
      this.runFrame(now);
    } catch (error) {
      if (!this.onError) throw error;
      try {
        this.stop();
      } catch (stopError) {
        // An onDisable that throws while the game is already failing: the first error matters.
        console.error(stopError);
      }
      this.onError(error);
    }
  };

  private runFrame(now: number): void {
    // Cleared so we can tell whether a system restarted the loop during this frame.
    this.frameId = 0;
    // The first frame's timestamp can be slightly earlier than start()'s performance.now().
    const elapsed = Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const { steps, accumulator } = advance(this.accumulator, elapsed);
    this.accumulator = accumulator;
    const updateStart = performance.now();
    for (let i = 0; i < steps; i++) {
      const active = this.scene;
      for (const system of active.systems.entries("update")) {
        // Checked as each runs: a system disabled earlier in this step sits it out.
        if (!system.enabled) continue;
        system.run(active.world, FIXED_STEP);
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
    const renderStart = performance.now();
    const { world, systems } = this.scene;
    for (const system of systems.entries("render")) if (system.enabled) system.run(world, elapsed);
    const renderEnd = performance.now();

    const sample: FrameSample = {
      time: now,
      scene: this.scenes.current,
      frame: elapsed * 1000,
      update: renderStart - updateStart,
      render: renderEnd - renderStart,
      steps,
      entities: world.entityCount,
      heapBytes: readHeapBytes(),
      inputs: this.keyboard.takeRecentPresses(),
    };
    this.perf.record(sample);
    this.perfOverlay?.logFrame(sample, this.perf);
    this.perfBroadcast?.frame(sample, this.perf);
    // Last, so it sits on top of everything and its own cost stays out of the render time.
    this.perfOverlay?.draw(this.canvas, this.perf);

    // A system may have called stop() (and maybe start(), which already scheduled a frame).
    if (this.running && this.frameId === 0) this.frameId = requestAnimationFrame(this.frame);
  }
}
