/**
 * Keyboard state, stored as a World resource.
 * Keys are KeyboardEvent.code values ("ArrowLeft", "KeyA", "Space"...),
 * which name physical keys, so WASD works on any keyboard layout.
 */
export class Keyboard {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  /** Real presses (no auto-repeat) since the last takeRecentPresses(), in order. */
  private recent: string[] = [];
  private target: EventTarget | null = null;

  private readonly onKeyDown = (event: Event): void => {
    this.handleKeyDown((event as KeyboardEvent).code);
  };
  private readonly onKeyUp = (event: Event): void => {
    this.handleKeyUp((event as KeyboardEvent).code);
  };
  private readonly onBlur = (): void => {
    this.clear();
  };

  /** True while the key is held down. */
  isDown(code: string): boolean {
    return this.held.has(code);
  }

  /** True if the key went down since the last update step. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Called by the game loop after each update step. */
  endStep(): void {
    this.pressed.clear();
  }

  handleKeyDown(code: string): void {
    // A keydown for a key that is already held is OS auto-repeat: ignore it.
    if (!this.held.has(code)) {
      this.pressed.add(code);
      this.recent.push(code);
    }
    this.held.add(code);
  }

  /**
   * The keys pressed since the last call, in order (a key pressed twice appears twice).
   * The game loop takes them once per frame for the performance figures.
   */
  takeRecentPresses(): string[] {
    const presses = this.recent;
    this.recent = [];
    return presses;
  }

  handleKeyUp(code: string): void {
    this.held.delete(code);
  }

  clear(): void {
    this.held.clear();
    this.pressed.clear();
  }

  attach(target: EventTarget): void {
    this.detach();
    this.target = target;
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("blur", this.onBlur);
  }

  detach(): void {
    if (!this.target) return;
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("blur", this.onBlur);
    this.target = null;
    this.clear();
  }
}
