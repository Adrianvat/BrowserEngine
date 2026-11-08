import type { System, World } from "../ecs/world";

/** When a system runs: at the fixed step, or once per frame after the renderer. */
export type SystemPhase = "update" | "render";

export const SYSTEM_PHASES: readonly SystemPhase[] = ["update", "render"];

/**
 * A system with what happens around it: its name (for switching it on and off), whether
 * it starts switched on, and what to do when it starts and stops running.
 */
export interface SystemDefinition {
  run: System;
  /** What Systems.enable/disable and messages call it; a bare function's own name by default. */
  name?: string;
  /** False: off until a script enables it. True by default. */
  startsEnabled?: boolean;
  /**
   * Called when the system starts running: its scene was entered (after the scene's
   * setup, so the entities are there), or it was enabled again.
   */
  onEnable?: (world: World) => void;
  /** Called when it stops running: its scene is left, the game stops, or it was disabled. */
  onDisable?: (world: World) => void;
}

/** A system as a scene adds it: a function, or a definition with a name and hooks. */
export type SystemLike = System | SystemDefinition;

/** A system of the running scene, with its switch. */
export interface RunningSystem {
  readonly name: string;
  readonly run: System;
  readonly phase: SystemPhase;
  readonly onEnable: ((world: World) => void) | null;
  readonly onDisable: ((world: World) => void) | null;
  enabled: boolean;
}

function define(system: SystemLike): SystemDefinition {
  return typeof system === "function" ? { run: system, name: system.name } : system;
}

/**
 * The systems of the running scene, each with a switch. Scripts switch systems off and
 * on through this (`world.getResource(Systems).disable("playerInput")` during a cutscene,
 * say); the change holds at once, and the system's onDisable/onEnable run right then.
 * A resource of every scene's World, filled by the scene's setup.
 */
export class Systems {
  private readonly list: RunningSystem[] = [];
  /** True from the scene's start until it is left: only then do the hooks run. */
  private up = false;

  constructor(private readonly world: World) {}

  /** Every system of the scene, in the order added. */
  get names(): string[] {
    return this.list.map((system) => system.name);
  }

  has(name: string): boolean {
    return this.list.some((system) => system.name === name);
  }

  /** Whether the named system runs; every system of that name must, if there are several. */
  isEnabled(name: string): boolean {
    return this.named(name).every((system) => system.enabled);
  }

  /** Switches a system on: it runs from the next step, and its onEnable runs now. */
  enable(name: string): void {
    for (const system of this.named(name)) {
      if (system.enabled) continue;
      system.enabled = true;
      if (this.up) system.onEnable?.(this.world);
    }
  }

  /** Switches a system off: it stops running at once, and its onDisable runs now. */
  disable(name: string): void {
    for (const system of this.named(name)) {
      if (!system.enabled) continue;
      system.enabled = false;
      if (this.up) system.onDisable?.(this.world);
    }
  }

  /** Called by the scene's setup (through SceneContext). A system added while the scene runs starts at once. */
  add(system: SystemLike, phase: SystemPhase): void {
    const definition = define(system);
    const running: RunningSystem = {
      name: definition.name ?? "",
      run: definition.run,
      phase,
      onEnable: definition.onEnable ?? null,
      onDisable: definition.onDisable ?? null,
      enabled: definition.startsEnabled ?? true,
    };
    this.list.push(running);
    if (this.up && running.enabled) running.onEnable?.(this.world);
  }

  /** Called by Game once the scene is set up: the enabled systems' onEnable, in order. */
  start(): void {
    if (this.up) return;
    this.up = true;
    for (const system of this.list) if (system.enabled) system.onEnable?.(this.world);
  }

  /** Called by Game when the scene is left: the enabled systems' onDisable, last added first. */
  stop(): void {
    if (!this.up) return;
    this.up = false;
    for (const system of [...this.list].reverse()) if (system.enabled) system.onDisable?.(this.world);
  }

  /** Called by Game every step/frame: the systems of a phase, enabled or not (checked as each runs). */
  entries(phase: SystemPhase): readonly RunningSystem[] {
    return this.list.filter((system) => system.phase === phase);
  }

  private named(name: string): RunningSystem[] {
    const found = this.list.filter((system) => system.name === name);
    if (found.length === 0) {
      throw new Error(`No system "${name}" in this scene (the systems are ${this.names.join(", ") || "none"})`);
    }
    return found;
  }
}
