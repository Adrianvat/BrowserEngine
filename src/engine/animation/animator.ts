/** Plays one of its sprite image's animation clips. */
export class Animator {
  /** Seconds since the clip started. */
  time = 0;
  /** True once a clip with `loop: false` has reached its end. */
  finished = false;

  constructor(public clip: string) {}

  /** Switches to another clip from its start. Does nothing if `clip` is already playing. */
  play(clip: string): void {
    if (clip === this.clip) return;
    this.clip = clip;
    this.restart();
  }

  /** Plays the current clip again from its start. */
  restart(): void {
    this.time = 0;
    this.finished = false;
  }
}
