import { checkSheet, type Assets } from "../../engine";
import { formatFrames, parseFrames } from "../frames-text";
import type { ClipChanges, ImageInfo, ImageLibrary } from "../image-library";
import { formatUsages, imageUsages } from "../image-usages";
import type { EditorModel } from "../model";

const PREVIEW_WIDTH = 240;
const PREVIEW_HEIGHT = 180;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The selected image: preview with numbered frames, frame size, clips, Delete.
 * Rebuilt when the image or its clip list changes; otherwise values are refreshed
 * in place, skipping the focused input and inputs showing a rejected value.
 */
export function mountImageDetails(
  root: HTMLElement,
  library: ImageLibrary,
  model: EditorModel,
  assets: Assets,
  report: (message: string) => void,
): (name: string | null) => void {
  root.className = "image-details";
  let current: string | null = null;
  let shape = "";
  let confirming = false;

  /** Runs a library write; marks `input` invalid with the message if it is rejected. */
  const attempt = (input: HTMLInputElement | null, write: () => Promise<unknown>) => {
    write().then(
      () => {
        input?.classList.remove("invalid");
        if (input) input.title = "";
        report("");
      },
      (error: unknown) => {
        input?.classList.add("invalid");
        if (input) input.title = messageOf(error);
        report(messageOf(error));
      },
    );
  };

  const build = (info: ImageInfo) => {
    root.replaceChildren();
    const readOnly = info.builtIn;

    if (info.error) {
      const error = document.createElement("p");
      error.className = "error";
      error.textContent = info.error;
      root.append(error);
    } else {
      root.append(preview(info, assets));
    }
    if (readOnly) {
      const note = document.createElement("p");
      note.textContent = "Defined in code";
      root.append(note);
    }

    if (!info.error) {
      const size = document.createElement("div");
      size.className = "frame-size";
      const width = numberInput("frameWidth", readOnly);
      const height = numberInput("frameHeight", readOnly);
      const commit = () => {
        const w = width.value === "" ? null : width.valueAsNumber;
        const h = height.value === "" ? null : height.valueAsNumber;
        attempt(width, () => library.setFrameSize(info.name, w, h));
      };
      width.addEventListener("change", commit);
      height.addEventListener("change", commit);
      size.append("Frame", width, "×", height);
      root.append(size);
    }

    if (info.sheet) {
      for (const clip of Object.keys(info.sheet.animations)) {
        root.append(clipRow(info.name, clip, readOnly));
      }
      if (!readOnly) {
        const add = document.createElement("button");
        add.textContent = "+ Add clip";
        add.addEventListener("click", () => attempt(null, () => library.addClip(info.name)));
        root.append(add);
      }
    }

    if (!readOnly) root.append(deleteControls(info.name));
  };

  const clipRow = (image: string, clip: string, readOnly: boolean) => {
    const row = document.createElement("div");
    row.className = "clip";
    row.dataset.clip = clip;
    const update = (input: HTMLInputElement, changes: () => ClipChanges | Error) => {
      input.addEventListener("change", () => {
        const next = changes();
        if (next instanceof Error) {
          attempt(input, () => Promise.reject(next));
        } else {
          attempt(input, () => library.updateClip(image, clip, next));
        }
      });
    };

    const name = textInput("name", readOnly);
    name.title = "Clip name";
    update(name, () => ({ name: name.value }));

    const frames = textInput("frames", readOnly);
    frames.title = "Frames, e.g. 2, 3, 4";
    update(frames, () => {
      const parsed = parseFrames(frames.value);
      return parsed === null ? new Error("Frames must be numbers like 2, 3, 4") : { frames: parsed };
    });

    const fps = numberInput("fps", readOnly);
    fps.title = "Frames per second";
    update(fps, () => ({ fps: fps.value === "" ? NaN : fps.valueAsNumber }));

    const loop = document.createElement("input");
    loop.type = "checkbox";
    loop.dataset.field = "loop";
    loop.title = "Loop";
    loop.disabled = readOnly;
    update(loop, () => ({ loop: loop.checked }));

    row.append(name, frames, fps, loop);
    if (!readOnly) {
      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.title = `Remove ${clip}`;
      remove.addEventListener("click", () => attempt(null, () => library.removeClip(image, clip)));
      row.append(remove);
    }
    return row;
  };

  const deleteControls = (name: string) => {
    const box = document.createElement("div");
    const remove = () => attempt(null, () => library.remove(name));
    if (!confirming) {
      const button = document.createElement("button");
      button.textContent = "Delete image";
      button.addEventListener("click", () => {
        if (imageUsages(name, model.allScenes(), model.registry).length === 0) {
          remove();
          return;
        }
        confirming = true;
        shape = "";
        show(current);
      });
      box.append(button);
      return box;
    }
    const usages = imageUsages(name, model.allScenes(), model.registry);
    const question = document.createElement("p");
    question.textContent = `Used by ${formatUsages(usages)}. Delete anyway?`;
    const yes = document.createElement("button");
    yes.textContent = "Delete";
    yes.addEventListener("click", () => {
      confirming = false;
      remove();
    });
    const no = document.createElement("button");
    no.textContent = "Cancel";
    no.addEventListener("click", () => {
      confirming = false;
      shape = "";
      show(current);
    });
    box.append(question, yes, no);
    return box;
  };

  /** Copies the image's values into the inputs. */
  const refresh = (info: ImageInfo) => {
    const set = (input: HTMLInputElement | null, value: string | boolean) => {
      if (!input || input === document.activeElement || input.classList.contains("invalid")) return;
      if (typeof value === "boolean") input.checked = value;
      else input.value = value;
    };
    const field = (scope: ParentNode, name: string) =>
      scope.querySelector<HTMLInputElement>(`[data-field="${name}"]`);
    set(field(root, "frameWidth"), info.sheet ? String(info.sheet.frameWidth) : "");
    set(field(root, "frameHeight"), info.sheet ? String(info.sheet.frameHeight) : "");
    for (const row of root.querySelectorAll<HTMLElement>(".clip")) {
      const clip = info.sheet?.animations[row.dataset.clip ?? ""];
      if (!clip) continue;
      set(field(row, "name"), row.dataset.clip ?? "");
      set(field(row, "frames"), formatFrames(clip.frames));
      set(field(row, "fps"), String(clip.fps));
      set(field(row, "loop"), clip.loop ?? true);
    }
    const canvas = root.querySelector("canvas");
    if (canvas) drawPreview(canvas, info, assets);
  };

  const show = (name: string | null) => {
    if (name !== current) confirming = false;
    current = name;
    if (name === null || !library.has(name)) {
      shape = "";
      root.replaceChildren();
      return;
    }
    const info = library.image(name);
    const next = JSON.stringify([
      name,
      info.error,
      info.sheet !== null,
      Object.keys(info.sheet?.animations ?? {}),
      confirming,
    ]);
    if (next !== shape) {
      shape = next;
      build(info);
    }
    refresh(info);
  };
  return show;
}

function numberInput(field: string, readOnly: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.dataset.field = field;
  input.disabled = readOnly;
  return input;
}

function textInput(field: string, readOnly: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.dataset.field = field;
  input.disabled = readOnly;
  return input;
}

function preview(info: ImageInfo, assets: Assets): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  drawPreview(canvas, info, assets);
  return canvas;
}

/** The image scaled to fit, with each frame outlined and numbered when it is a sheet. */
function drawPreview(canvas: HTMLCanvasElement, info: ImageInfo, assets: Assets): void {
  if (info.width === null || info.height === null || !assets.hasImage(info.name)) return;
  const scale = Math.min(PREVIEW_WIDTH / info.width, PREVIEW_HEIGHT / info.height, 8);
  canvas.width = Math.max(1, Math.round(info.width * scale));
  canvas.height = Math.max(1, Math.round(info.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(assets.getImage(info.name), 0, 0, canvas.width, canvas.height);
  if (!info.sheet) return;

  const { columns, count } = checkSheet(info.name, info.width, info.height, info.sheet);
  const w = info.sheet.frameWidth * scale;
  const h = info.sheet.frameHeight * scale;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.8)";
  ctx.lineWidth = 1;
  ctx.font = "10px monospace";
  ctx.textBaseline = "top";
  for (let index = 0; index < count; index++) {
    const x = (index % columns) * w;
    const y = Math.floor(index / columns) * h;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(x + 1, y + 1, 7 * String(index).length + 4, 12);
    ctx.fillStyle = "#fff";
    ctx.fillText(String(index), x + 3, y + 2);
  }
}
