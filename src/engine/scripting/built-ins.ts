/**
 * The systems the engine provides that a project runs by adding them as scripts: a
 * one-line script re-exporting the engine's function, so the system can be ordered
 * among the project's own (input before physics, touch reactions after it, say).
 * Rendering and animation are not here: the game runs them itself, after the systems.
 */
export interface BuiltInSystem {
  /** The engine export, which is also the script's name. */
  name: string;
  /** What it does, for the code editor and the script's comment. */
  description: string;
}

export const BUILT_IN_SYSTEMS: readonly BuiltInSystem[] = [
  {
    name: "physics",
    description:
      "The engine's physics step: gravity, forces and impulses change every Body's Velocity, " +
      "Velocities move Transforms, and overlapping Colliders are pushed apart. Put the systems " +
      "that steer things (input) before it and the ones that react to touches (Contacts) after it.",
  },
];

export function isBuiltInSystem(name: string): boolean {
  return BUILT_IN_SYSTEMS.some((system) => system.name === name);
}
