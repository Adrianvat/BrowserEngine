import type { System, World } from "../ecs/world";

/** One part of a game (title screen, level...). `setup` fills its fresh World. */
export interface Scene {
  setup(scene: SceneContext): void;
}

/** What a scene's setup gets: its own World and a place for its systems. */
export interface SceneContext {
  readonly world: World;
  /** Adds a system that runs at a fixed 60 Hz while this scene runs, in the order added. */
  addSystem(system: System): void;
  /** Adds a system that runs once per browser frame, after the built-in renderer. */
  addRenderSystem(system: System): void;
}

/** Lets systems switch scenes. A global resource, present in every scene's World. */
export class Scenes {
  private currentName = "";
  private requested: string | null = null;

  constructor(private readonly exists: (name: string) => boolean) {}

  /** The name of the running scene. */
  get current(): string {
    return this.currentName;
  }

  /** Switches to another scene (or restarts this one) at the end of the current step. */
  switchTo(name: string): void {
    if (!this.exists(name)) throw new Error(`Scene "${name}" not found`);
    this.requested = name;
  }

  /** Called by Game when a scene starts. Drops any request made before it. */
  enter(name: string): void {
    this.currentName = name;
    this.requested = null;
  }

  /** Called by Game at the end of each step: the requested scene, if any. */
  takeRequest(): string | null {
    const name = this.requested;
    this.requested = null;
    return name;
  }
}
