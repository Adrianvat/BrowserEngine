import { describe, it, expect } from "vitest";
import { Drag } from "../../src/editor/drag";

describe("Drag", () => {
  // Entity 2, pressed at (100, 50) while it stood at (10, 20).
  const start = () => new Drag(2, { x: 100, y: 50 }, { x: 10, y: 20 });

  it("moves the entity by the pointer's movement, in whole pixels", () => {
    expect(start().to({ x: 130.6, y: 40.2 })).toEqual({ x: 41, y: 10 });
  });

  it("has nothing to save when the pointer never moved the entity by a whole pixel", () => {
    const drag = start();
    drag.to({ x: 100.3, y: 49.8 });
    expect(drag.end()).toBeNull();
  });

  it("has nothing to save when the entity ends where it started", () => {
    const drag = start();
    drag.to({ x: 150, y: 50 });
    drag.to({ x: 100, y: 50 });
    expect(drag.end()).toBeNull();
  });

  it("saves the last position when the entity moved", () => {
    const drag = start();
    drag.to({ x: 150, y: 60 });
    expect(drag.end()).toEqual({ x: 60, y: 30 });
  });

  it("is only still valid while its entity is the selection", () => {
    const drag = start();
    expect(drag.stillValid(2)).toBe(true);
    expect(drag.stillValid(null)).toBe(false);
    expect(drag.stillValid(1)).toBe(false);
  });
});
