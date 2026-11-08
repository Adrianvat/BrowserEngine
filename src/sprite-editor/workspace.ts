import type { StoredSheet } from "../engine";
import type { FramesDocument } from "./frames-document";

/** How a sprite is drawn: as pixels, or as shapes. */
export type Style = "pixel" | "vector";

export const STYLES: readonly { style: Style; label: string }[] = [
  { style: "pixel", label: "Pixel art" },
  { style: "vector", label: "Vector" },
];

/** Where a workspace puts its views. */
export interface Mounts {
  tools: HTMLElement;
  view: HTMLElement;
  frames: HTMLElement;
  animation: HTMLElement;
}

export type Report = (message: string, kind?: "" | "error" | "saved") => void;

/** A style's document with the views that edit it. One is active at a time. */
export interface Workspace {
  readonly style: Style;
  /** The label used in messages, e.g. "pixel-art". */
  readonly label: string;
  readonly doc: FramesDocument<unknown>;
  /** Starts a blank, single-frame sprite of this size. */
  reset(width: number, height: number): void;
  /** The file to store and its sheet layout. */
  export(): Promise<{ file: Blob; sheet: StoredSheet | null }>;
  /** Puts the views in the page; `signal`-aware listeners are dropped by unmount. */
  mount(mounts: Mounts, report: Report): void;
  unmount(): void;
  /** The same sprite in the other style: pixels traced into rectangles, or shapes painted into pixels. */
  convert(): Workspace;
  /** True when converting throws away something (shapes become pixels for good). */
  readonly lossyToConvert: boolean;
}

/** Holds the active workspace and swaps it; views that outlive a swap listen for it. */
export class EditorShell {
  private current: Workspace;
  private readonly listeners: (() => void)[] = [];

  constructor(
    initial: Workspace,
    private readonly mounts: Mounts,
    private readonly report: Report,
  ) {
    this.current = initial;
    initial.mount(mounts, report);
  }

  get workspace(): Workspace {
    return this.current;
  }

  /** Called after the workspace was swapped. */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** Makes `workspace` the active one, in place of the current one. */
  use(workspace: Workspace): void {
    this.current.unmount();
    this.current = workspace;
    workspace.mount(this.mounts, this.report);
    for (const listener of this.listeners) listener();
  }

  /** Converts the sprite to `style` and edits it there; nothing happens for the current style. */
  switchStyle(style: Style): void {
    if (style === this.current.style) return;
    this.use(this.current.convert());
  }
}
