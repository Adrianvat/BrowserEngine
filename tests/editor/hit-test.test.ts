import { describe, it, expect } from "vitest";
import { entityBox, hasDrawable, hitTest, MARKER_SIZE } from "../../src/editor/hit-test";
import { Assets, Layer, Rect, Sprite, Text, Transform, World, type Entity } from "../../src/engine";

async function setup() {
  const world = new World();
  const assets = new Assets(
    async (url) =>
      (url === "/sheet.png" ? { width: 64, height: 32 } : { width: 50, height: 40 }) as HTMLImageElement,
  );
  await assets.loadImages({
    bg: "/bg.png",
    sheet: { url: "/sheet.png", frameWidth: 16, frameHeight: 16 },
  });
  const spawn = (...components: object[]) => {
    const entity = world.spawn();
    for (const component of components) world.add(entity, component);
    return entity;
  };
  /** Pretends every character is 10px wide. */
  const measure = (text: Text) => text.value.length * 10;
  const box = (entity: Entity) => entityBox(world, entity, assets, measure);
  const hit = (x: number, y: number) => hitTest(world, { x, y }, assets, measure);
  return { world, spawn, box, hit };
}

describe("entityBox", () => {
  it("uses a Rect's size at the Transform", async () => {
    const { spawn, box } = await setup();
    const e = spawn(new Transform(10, 20), new Rect(30, 40));
    expect(box(e)).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it("uses a Sprite's natural size, its frame's size, or its own size", async () => {
    const { spawn, box } = await setup();
    expect(box(spawn(new Transform(), new Sprite("bg")))).toMatchObject({ width: 50, height: 40 });
    expect(box(spawn(new Transform(), new Sprite("sheet", { frame: 5 })))).toMatchObject({
      width: 16,
      height: 16,
    });
    const sized = spawn(new Transform(), new Sprite("sheet", { width: 32, height: 48, flipX: true }));
    expect(box(sized)).toMatchObject({ width: 32, height: 48 });
  });

  it("places a Text box by its alignment, with the font size as its height", async () => {
    const { spawn, box } = await setup();
    const at = new Transform(100, 50);
    expect(box(spawn(at, new Text("abc", { size: 20 })))).toEqual({
      x: 100,
      y: 50,
      width: 30,
      height: 20,
    });
    expect(box(spawn(at, new Text("abc", { size: 20, align: "center" })))?.x).toBe(85);
    expect(box(spawn(at, new Text("abc", { size: 20, align: "right" })))?.x).toBe(70);
  });

  it("covers everything an entity draws", async () => {
    const { spawn, box } = await setup();
    const e = spawn(new Transform(0, 0), new Rect(10, 10), new Text("abcdef", { size: 5 }));
    expect(box(e)).toEqual({ x: 0, y: 0, width: 60, height: 10 });
  });

  it("gives an entity with nothing to draw a marker box centered on its Transform", async () => {
    const { spawn, box } = await setup();
    const half = MARKER_SIZE / 2;
    expect(box(spawn(new Transform(10, 10)))).toEqual({
      x: 10 - half,
      y: 10 - half,
      width: MARKER_SIZE,
      height: MARKER_SIZE,
    });
  });

  it("uses the marker box for a sprite that cannot be drawn", async () => {
    const { spawn, box } = await setup();
    expect(box(spawn(new Transform(10, 10), new Sprite("missing")))?.width).toBe(MARKER_SIZE);
    expect(box(spawn(new Transform(10, 10), new Sprite("sheet", { frame: 99 })))?.width).toBe(
      MARKER_SIZE,
    );
  });

  it("has no box without a Transform", async () => {
    const { spawn, box } = await setup();
    expect(box(spawn(new Rect(10, 10)))).toBeNull();
  });
});

describe("hasDrawable", () => {
  it("is true for a Rect, Sprite or Text, and false otherwise", async () => {
    const { world, spawn } = await setup();
    expect(hasDrawable(world, spawn(new Transform(), new Rect()))).toBe(true);
    expect(hasDrawable(world, spawn(new Transform(), new Sprite("bg")))).toBe(true);
    expect(hasDrawable(world, spawn(new Transform(), new Text("a")))).toBe(true);
    expect(hasDrawable(world, spawn(new Transform(), new Layer(2)))).toBe(false);
  });
});

describe("hitTest", () => {
  it("finds the entity under the point, or null over empty space", async () => {
    const { spawn, hit } = await setup();
    const e = spawn(new Transform(10, 10), new Rect(20, 20));
    expect(hit(15, 15)).toBe(e);
    expect(hit(50, 50)).toBeNull();
  });

  it("includes the left and top edges but not the right and bottom ones", async () => {
    const { spawn, hit } = await setup();
    const e = spawn(new Transform(10, 10), new Rect(20, 20));
    expect(hit(10, 10)).toBe(e);
    expect(hit(30, 15)).toBeNull();
    expect(hit(15, 30)).toBeNull();
  });

  it("picks the higher layer, even when it was spawned first", async () => {
    const { spawn, hit } = await setup();
    const top = spawn(new Transform(0, 0), new Rect(20, 20), new Layer(1));
    spawn(new Transform(0, 0), new Rect(20, 20));
    expect(hit(5, 5)).toBe(top);
  });

  it("on the same layer, picks the entity spawned last", async () => {
    const { spawn, hit } = await setup();
    spawn(new Transform(0, 0), new Rect(20, 20));
    const last = spawn(new Transform(0, 0), new Rect(20, 20));
    expect(hit(5, 5)).toBe(last);
  });

  it("can pick an entity by its marker", async () => {
    const { spawn, hit } = await setup();
    const e = spawn(new Transform(50, 50));
    expect(hit(52, 48)).toBe(e);
  });
});
