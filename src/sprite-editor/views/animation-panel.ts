import { formatFrames, parseFrames } from "../../editor/frames-text";
import type { FramesDocument } from "../frames-document";
import { DEFAULT_FPS, type ClipChanges } from "../sheet";
import type { FrameRenderer } from "./frame-strip";

/** The preview fits in this many CSS pixels on each side. */
const PREVIEW_SIZE = 160;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function heading(text: string): HTMLHeadingElement {
  const h2 = document.createElement("h2");
  h2.textContent = text;
  return h2;
}

function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = text;
  element.title = title;
  element.addEventListener("click", onClick);
  return element;
}

/**
 * Plays the animation (a clip, or every frame in turn) in a small preview, and lists
 * the clips with their frames, speed and looping. The clip list is rebuilt only when
 * clips come or go; otherwise values are refreshed in place, skipping the focused input.
 */
export function mountAnimationPanel(
  root: HTMLElement,
  doc: FramesDocument<unknown>,
  render: FrameRenderer,
  report: (message: string, kind?: "" | "error") => void,
  signal: AbortSignal,
): void {
  // Preview
  const preview = document.createElement("canvas");
  preview.className = "preview";
  const previewCtx = preview.getContext("2d");

  const clipSelect = document.createElement("select");
  clipSelect.title = "What the preview plays";
  const play = button("Pause", "Play or pause the preview", () => {
    playing = !playing;
    play.textContent = playing ? "Pause" : "Play";
    if (playing && animationFrame === 0) {
      lastTime = 0;
      carry = 0;
      animationFrame = requestAnimationFrame(tick);
    }
  });
  const fpsInput = document.createElement("input");
  fpsInput.type = "number";
  fpsInput.min = "1";
  fpsInput.value = String(DEFAULT_FPS);
  fpsInput.title = "Speed of the all-frames preview; a clip plays at its own speed";
  const fpsLabel = document.createElement("label");
  fpsLabel.append(fpsInput, " fps");
  const counter = document.createElement("span");
  counter.className = "frame-label";
  const previewControls = document.createElement("div");
  previewControls.className = "edit-buttons";
  previewControls.append(clipSelect, play, fpsLabel, counter);

  let playing = true;
  let position = 0;
  let lastTime = 0;
  let carry = 0;
  let animationFrame = 0;

  /** The frames and speed the preview plays: the chosen clip's, or every frame at the fps input. */
  const sequence = (): { frames: number[]; fps: number; loop: boolean } => {
    const clip = doc.clips[clipSelect.value];
    if (clip) return { frames: clip.frames, fps: clip.fps, loop: clip.loop ?? true };
    const fps = fpsInput.valueAsNumber;
    return {
      frames: doc.frames.map((_, index) => index),
      fps: Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS,
      loop: true,
    };
  };

  const drawPreview = () => {
    if (!previewCtx) return;
    const { frames } = sequence();
    if (position >= frames.length) position = 0;
    const index = frames[position] ?? 0;
    if (index >= doc.frameCount) return;
    const scale = Math.max(1, Math.floor(Math.min(PREVIEW_SIZE / doc.width, PREVIEW_SIZE / doc.height)));
    const width = doc.width * scale;
    const height = doc.height * scale;
    if (preview.width !== width || preview.height !== height) {
      preview.width = width;
      preview.height = height;
    }
    previewCtx.clearRect(0, 0, width, height);
    render(previewCtx, index, scale);
    counter.textContent = `frame ${index}`;
  };

  /** Advances the preview at its fps, once per animation frame while playing. */
  const tick = (now: number) => {
    animationFrame = 0;
    if (!playing || signal.aborted) return;
    const { frames, fps, loop } = sequence();
    if (lastTime === 0) lastTime = now;
    carry += ((now - lastTime) / 1000) * fps;
    lastTime = now;
    const steps = Math.floor(carry);
    carry -= steps;
    if (steps > 0) {
      if (loop) position = (position + steps) % frames.length;
      else position = Math.min(frames.length - 1, position + steps);
      drawPreview();
    }
    animationFrame = requestAnimationFrame(tick);
  };

  clipSelect.addEventListener("change", () => {
    position = 0;
    drawPreview();
  });
  fpsInput.addEventListener("change", () => {
    carry = 0;
  });

  // Clips
  const clips = document.createElement("div");
  const addClip = button("+ Add clip", "Add a clip playing the current frame", () =>
    attempt(null, () => doc.addClip()),
  );
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "A clip names frames to play in order (e.g. 2, 3, 4), at a speed, looping or not. " +
    "The game plays clips with the Animator component.";

  /** Runs a document edit; marks `input` invalid with the message if it is refused. */
  const attempt = (input: HTMLInputElement | null, edit: () => unknown) => {
    try {
      edit();
      input?.classList.remove("invalid");
      if (input) input.title = "";
      report("");
    } catch (error) {
      input?.classList.add("invalid");
      if (input) input.title = messageOf(error);
      report(messageOf(error), "error");
    }
  };

  const clipRow = (clip: string) => {
    const row = document.createElement("div");
    row.className = "clip";
    // Kept current by refresh(), since a rename doesn't rebuild the row.
    row.dataset.clip = clip;
    const currentClip = () => row.dataset.clip ?? clip;
    const field = (type: string, name: string, title: string) => {
      const input = document.createElement("input");
      input.type = type;
      input.dataset.field = name;
      input.title = title;
      return input;
    };
    const update = (input: HTMLInputElement, changes: () => ClipChanges | Error) => {
      input.addEventListener("change", () => {
        const next = changes();
        attempt(input, () => {
          if (next instanceof Error) throw next;
          doc.updateClip(currentClip(), next);
        });
      });
    };
    const name = field("text", "name", "Clip name");
    update(name, () => ({ name: name.value }));
    const frames = field("text", "frames", "Frames to play, e.g. 2, 3, 4");
    update(frames, () => {
      const parsed = parseFrames(frames.value);
      return parsed === null ? new Error("Frames must be numbers like 2, 3, 4") : { frames: parsed };
    });
    const fps = field("number", "fps", "Frames per second");
    fps.min = "1";
    update(fps, () => ({ fps: fps.value === "" ? NaN : fps.valueAsNumber }));
    const loop = field("checkbox", "loop", "Loop");
    update(loop, () => ({ loop: loop.checked }));
    const remove = button("×", "Remove clip", () => attempt(null, () => doc.removeClip(currentClip())));
    row.append(name, frames, fps, loop, remove);
    return row;
  };

  let shape = "";
  const rebuild = () => {
    clips.replaceChildren();
    for (const clip of Object.keys(doc.clips)) clips.append(clipRow(clip));
    const chosen = clipSelect.value;
    clipSelect.replaceChildren(new Option("All frames", ""));
    for (const clip of Object.keys(doc.clips)) clipSelect.append(new Option(clip, clip));
    clipSelect.value = Object.hasOwn(doc.clips, chosen) ? chosen : "";
  };

  /** Copies the clips' values into the inputs. */
  const refresh = () => {
    const set = (input: HTMLInputElement | null, value: string | boolean) => {
      if (!input || input === document.activeElement || input.classList.contains("invalid")) return;
      if (typeof value === "boolean") input.checked = value;
      else input.value = value;
    };
    const names = Object.keys(doc.clips);
    clips.querySelectorAll<HTMLElement>(".clip").forEach((row, index) => {
      const name = names[index];
      const clip = doc.clips[name];
      if (name === undefined || !clip) return;
      if (row.dataset.clip !== name) {
        row.dataset.clip = name;
        const option = clipSelect.options[index + 1];
        if (option) {
          option.text = name;
          option.value = name;
        }
      }
      set(row.querySelector('[data-field="name"]'), name);
      set(row.querySelector('[data-field="frames"]'), formatFrames(clip.frames));
      set(row.querySelector('[data-field="fps"]'), String(clip.fps));
      set(row.querySelector('[data-field="loop"]'), clip.loop ?? true);
    });
  };

  root.replaceChildren(heading("Preview"), preview, previewControls, heading("Clips"), clips, addClip, hint);

  const update = () => {
    const next = String(Object.keys(doc.clips).length);
    if (next !== shape) {
      shape = next;
      rebuild();
    }
    refresh();
    drawPreview();
  };
  doc.onChange(update);
  update();
  drawPreview();
  animationFrame = requestAnimationFrame(tick);
  signal.addEventListener("abort", () => cancelAnimationFrame(animationFrame));
}
