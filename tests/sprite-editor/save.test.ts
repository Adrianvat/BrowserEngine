import { describe, expect, it } from "vitest";
import type { ImageFile } from "../../src/engine";
import { planSave, savedMessage } from "../../src/sprite-editor/save";

const stored: ImageFile[] = [{ name: "coin", url: "/api/projects/demo/images/files/coin.png" }];

describe("planSave", () => {
  it("tidies the name and says whether an image file is replaced", () => {
    expect(planSave(" My Coin! ", stored)).toEqual({ name: "my-coin", replaces: false });
    expect(planSave("Coin", stored)).toEqual({ name: "coin", replaces: true });
  });

  it("refuses an empty name", () => {
    expect(() => planSave("", stored)).toThrow("Give the sprite a name");
    expect(() => planSave("!!!", stored)).toThrow("Give the sprite a name");
  });
});

describe("savedMessage", () => {
  it("names the image and says what kind of thing was saved", () => {
    const plan = planSave("coin", stored);
    expect(savedMessage(plan, 1, 0, "pixel-art")).toBe(
      'Saved "coin" as a pixel-art image in the project\'s images; it is in the scene editor\'s image list',
    );
    expect(savedMessage(plan, 4, 1, "vector")).toContain("a vector sheet of 4 frames and 1 clip");
    expect(savedMessage(plan, 1, 2, "pixel-art")).toContain("a pixel-art sheet of 1 frame and 2 clips");
  });
});
