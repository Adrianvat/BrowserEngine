import { physics } from "engine";

export const scenes = ["play"];

// The engine's physics step: gravity, forces and impulses change every Body's Velocity,
// Velocities move Transforms, and overlapping Colliders are pushed apart. It is a script
// so it can be ordered: put the systems that steer things (input) before it and the ones
// that react to touches (Contacts) after it.
export default physics;
