import { describe, expect, it } from "vitest";
import type { ImageInfo } from "../../src/editor/image-library";
import { detailsShape } from "../../src/editor/views/image-details";

function slime(animations: Record<string, { frames: number[]; fps: number }>): ImageInfo {
  return {
    name: "slime",
    builtIn: false,
    sheet: { frameWidth: 16, frameHeight: 16, animations },
    width: 64,
    height: 32,
    frameCount: 8,
    error: null,
  };
}

describe("detailsShape", () => {
  it("stays the same when a clip is renamed, so the panel isn't rebuilt under the focused input", () => {
    expect(detailsShape(slime({ walk: { frames: [0], fps: 8 } }), false)).toBe(
      detailsShape(slime({ clip: { frames: [0], fps: 8 } }), false),
    );
  });

  it("changes when clips are added or removed, the sheet is toggled, or delete is being confirmed", () => {
    const one = detailsShape(slime({ clip: { frames: [0], fps: 8 } }), false);
    expect(detailsShape(slime({}), false)).not.toBe(one);
    expect(detailsShape({ ...slime({}), sheet: null }, false)).not.toBe(detailsShape(slime({}), false));
    expect(detailsShape(slime({ clip: { frames: [0], fps: 8 } }), true)).not.toBe(one);
  });
});
