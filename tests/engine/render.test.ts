import { describe, it, expect } from "vitest";
import { Assets } from "../../src/engine/assets/assets";
import { World } from "../../src/engine/ecs/world";
import { Layer, Rect, Sprite, Text, Transform } from "../../src/engine/render/components";
import { render } from "../../src/engine/render/systems";
import { recordingCanvas } from "../helpers/recording-canvas";

const bgImage = { width: 50, height: 40 } as HTMLImageElement;
const heroImage = { width: 64, height: 32 } as HTMLImageElement; // 4x2 frames of 16x16

async function setup() {
  const world = new World();
  const { canvas, calls, texts } = recordingCanvas(100, 100);
  const files: Record<string, HTMLImageElement> = { "/bg.png": bgImage, "/hero.png": heroImage };
  const assets = new Assets(async (url) => files[url]);
  await assets.loadImages({
    bg: "/bg.png",
    hero: { url: "/hero.png", frameWidth: 16, frameHeight: 16 },
  });
  world.setResource(canvas);
  world.setResource(assets);

  const spawn = (...components: object[]) => {
    const entity = world.spawn();
    for (const component of components) world.add(entity, component);
    return entity;
  };
  /** Calls after the initial clearRect. */
  const draws = () => calls.slice(1);
  /** Short names for draw order checks: the rect's color, or "drawImage". */
  const order = () => draws().map((call) => (call[0] === "fillRect" ? call[1] : call[0]));
  return { world, calls, texts, spawn, draws, order };
}

describe("render", () => {
  it("clears the whole canvas first", async () => {
    const { world, calls } = await setup();
    render(world);
    expect(calls).toEqual([["clearRect", 0, 0, 100, 100]]);
  });

  it("still draws rects", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Transform(1, 2), new Rect(3, 4, "red"));
    render(world);
    expect(draws()).toEqual([["fillRect", "red", 1, 2, 3, 4]]);
  });

  it("draws a single image at its natural size", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Transform(5, 6), new Sprite("bg"));
    render(world);
    expect(draws()).toEqual([["drawImage", bgImage, 0, 0, 50, 40, 5, 6, 50, 40]]);
  });

  it("draws the chosen sheet frame at an explicit size", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Transform(0, 0), new Sprite("hero", { frame: 5, width: 32, height: 24 }));
    render(world);
    expect(draws()).toEqual([["drawImage", heroImage, 16, 16, 16, 16, 0, 0, 32, 24]]);
  });

  it("flipX mirrors the sprite in place", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Transform(10, 20), new Sprite("hero", { width: 32, height: 24, flipX: true }));
    render(world);
    expect(draws()).toEqual([
      ["save"],
      ["translate", 42, 20],
      ["scale", -1, 1],
      ["drawImage", heroImage, 0, 0, 16, 16, 0, 0, 32, 24],
      ["restore"],
    ]);
  });

  it("flipY mirrors the sprite in place", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Transform(10, 20), new Sprite("hero", { width: 32, height: 24, flipY: true }));
    render(world);
    expect(draws()).toEqual([
      ["save"],
      ["translate", 10, 44],
      ["scale", 1, -1],
      ["drawImage", heroImage, 0, 0, 16, 16, 0, 0, 32, 24],
      ["restore"],
    ]);
  });

  it("flipX and flipY together", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Transform(10, 20), new Sprite("bg", { flipX: true, flipY: true }));
    render(world);
    expect(draws()).toEqual([
      ["save"],
      ["translate", 60, 60],
      ["scale", -1, -1],
      ["drawImage", bgImage, 0, 0, 50, 40, 0, 0, 50, 40],
      ["restore"],
    ]);
  });

  it("draws lower layers first, then by spawn order", async () => {
    const { world, spawn, order } = await setup();
    spawn(new Transform(), new Rect(1, 1, "top"), new Layer(1));
    spawn(new Transform(), new Rect(1, 1, "middle-a"));
    spawn(new Transform(), new Sprite("bg"), new Layer(-1));
    spawn(new Transform(), new Rect(1, 1, "middle-b"), new Layer(0));
    render(world);
    expect(order()).toEqual(["drawImage", "middle-a", "middle-b", "top"]);
  });

  it("orders by spawn order within a layer, not by component kind", async () => {
    const { world, spawn, order } = await setup();
    spawn(new Transform(), new Sprite("bg"));
    spawn(new Transform(), new Rect(1, 1, "red"));
    render(world);
    expect(order()).toEqual(["drawImage", "red"]);
  });

  it("draws an entity's rect under its own sprite", async () => {
    const { world, spawn, order } = await setup();
    spawn(new Transform(), new Sprite("bg"), new Rect(1, 1, "red"));
    render(world);
    expect(order()).toEqual(["red", "drawImage"]);
  });

  it("skips entities without a Transform", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Sprite("bg"));
    spawn(new Rect(1, 1, "red"));
    render(world);
    expect(draws()).toEqual([]);
  });

  it("throws for a sprite whose image is not loaded", async () => {
    const { world, spawn } = await setup();
    spawn(new Transform(), new Sprite("nope"));
    expect(() => render(world)).toThrow('Image "nope" is not loaded');
  });

  it("draws text at the Transform with its font, color, alignment and a top baseline", async () => {
    const { world, spawn, draws, texts } = await setup();
    spawn(
      new Transform(10, 20),
      new Text("Hi", { size: 24, color: "red", font: "monospace", align: "center" }),
    );
    render(world);
    expect(draws()).toEqual([["fillText", "Hi", 10, 20]]);
    expect(texts).toEqual([
      {
        value: "Hi",
        x: 10,
        y: 20,
        font: "24px monospace",
        fillStyle: "red",
        textAlign: "center",
        textBaseline: "top",
      },
    ]);
  });

  it("uses 16px white sans-serif, left-aligned, by default", async () => {
    const { world, spawn, texts } = await setup();
    spawn(new Transform(), new Text("a"));
    render(world);
    expect(texts[0]).toMatchObject({
      font: "16px sans-serif",
      fillStyle: "white",
      textAlign: "left",
    });
  });

  it("sorts text by layer with rects and sprites", async () => {
    const { world, spawn, order } = await setup();
    spawn(new Transform(), new Rect(1, 1, "red"));
    spawn(new Transform(), new Text("under"), new Layer(-1));
    spawn(new Transform(), new Sprite("bg"), new Layer(1));
    render(world);
    expect(order()).toEqual(["fillText", "red", "drawImage"]);
  });

  it("draws an entity's text on top of its own rect and sprite", async () => {
    const { world, spawn, order } = await setup();
    spawn(new Transform(), new Text("label"), new Sprite("bg"), new Rect(1, 1, "red"));
    render(world);
    expect(order()).toEqual(["red", "drawImage", "fillText"]);
  });

  it("skips text without a Transform", async () => {
    const { world, spawn, draws } = await setup();
    spawn(new Text("lost"));
    render(world);
    expect(draws()).toEqual([]);
  });
});

