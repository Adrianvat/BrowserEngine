import {
  Canvas,
  render,
  spawnSceneData,
  Transform,
  World,
  type Assets,
  type Entity,
  type Text,
} from "../../engine";
import { Drag } from "../drag";
import { entityBox, hasDrawable, hitTest, MARKER_SIZE } from "../hit-test";
import type { EditorModel } from "../model";

/** Draws the scene with the engine's renderer; click selects, drag moves. */
export function mountViewport(element: HTMLCanvasElement, model: EditorModel, assets: Assets): void {
  const { width, height, pixelArt } = model.definition;
  const canvas = new Canvas(element, width, height);
  const { ctx } = canvas;
  ctx.imageSmoothingEnabled = !pixelArt;

  const measure = (text: Text) => {
    ctx.font = `${text.size}px ${text.font}`;
    return ctx.measureText(text.value).width;
  };

  let world = new World();
  /** entities[i] is the entity spawned for data.entities[i]. */
  let entities: Entity[] = [];
  let drag: Drag | null = null;

  const drawOverlay = () => {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#facc15";
    const half = MARKER_SIZE / 2;
    for (const entity of entities) {
      const transform = world.get(entity, Transform);
      if (!transform || hasDrawable(world, entity)) continue;
      ctx.beginPath();
      ctx.moveTo(transform.x - half, transform.y);
      ctx.lineTo(transform.x + half, transform.y);
      ctx.moveTo(transform.x, transform.y - half);
      ctx.lineTo(transform.x, transform.y + half);
      ctx.stroke();
    }
    const selected = model.selected === null ? undefined : entities[model.selected];
    const box = selected === undefined ? null : entityBox(world, selected, assets, measure);
    if (box) {
      ctx.strokeStyle = "#38bdf8";
      ctx.strokeRect(box.x - 0.5, box.y - 0.5, box.width + 1, box.height + 1);
    }
    ctx.restore();
  };

  const draw = () => {
    world = new World();
    world.setResource(canvas);
    world.setResource(assets);
    entities = [];
    if (model.loadError) {
      drawMessage(ctx, width, height, model.loadError);
      return;
    }
    try {
      entities = spawnSceneData(world, model.data, model.registry);
      render(world);
      drawOverlay();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      drawMessage(ctx, width, height, `Cannot draw this scene: ${message}`);
    }
  };

  /** Pointer position in scene pixels, whatever size CSS shows the canvas at. */
  const toScene = (event: PointerEvent) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * width) / bounds.width,
      y: ((event.clientY - bounds.top) * height) / bounds.height,
    };
  };

  element.addEventListener("pointerdown", (event) => {
    if (model.loadError) return;
    const point = toScene(event);
    const hit = hitTest(world, point, assets, measure);
    const index = hit === null ? -1 : entities.indexOf(hit);
    model.select(index === -1 ? null : index);
    if (index === -1) return;
    const transform = model.data.entities[index].components.Transform ?? {};
    drag = new Drag(index, point, {
      x: typeof transform.x === "number" ? transform.x : 0,
      y: typeof transform.y === "number" ? transform.y : 0,
    });
    element.setPointerCapture(event.pointerId);
  });

  element.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const { x, y } = drag.to(toScene(event));
    model.move(drag.index, x, y, false);
  });

  const endDrag = () => {
    // Moves during the drag were not saved; save the final position once.
    const end = drag?.end();
    if (drag && end) model.move(drag.index, end.x, end.y);
    drag = null;
  };
  element.addEventListener("pointerup", endDrag);
  element.addEventListener("pointercancel", endDrag);

  model.onChange(() => {
    // The dragged entity was removed or deselected (e.g. Delete during a drag).
    if (drag && !drag.stillValid(model.selected)) drag = null;
    draw();
  });
  draw();
}

/** Clears the canvas and shows a message, wrapped to fit. */
function drawMessage(ctx: CanvasRenderingContext2D, width: number, height: number, text: string) {
  const charsPerLine = Math.max(1, Math.floor((width - 32) / 9));
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.fillStyle = "#f87171";
  ctx.font = "16px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i * charsPerLine < text.length; i++) {
    ctx.fillText(text.slice(i * charsPerLine, (i + 1) * charsPerLine), 16, 16 + i * 22);
  }
  ctx.restore();
}
