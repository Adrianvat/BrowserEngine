/** Update systems always run with this step, in seconds (60 Hz). */
export const FIXED_STEP = 1 / 60;

/** Longest frame we simulate, in seconds. Prevents huge catch-up bursts. */
export const MAX_FRAME_TIME = 0.25;

export interface StepResult {
  /** How many fixed update steps to run this frame. */
  steps: number;
  /** Leftover time to carry into the next frame. */
  accumulator: number;
}

/** Adds a frame's elapsed time and works out how many fixed steps to run. */
export function advance(
  accumulator: number,
  elapsed: number,
  step = FIXED_STEP,
  maxFrame = MAX_FRAME_TIME,
): StepResult {
  let acc = accumulator + Math.min(Math.max(elapsed, 0), maxFrame);
  let steps = 0;
  while (acc >= step) {
    acc -= step;
    steps++;
  }
  return { steps, accumulator: acc };
}
