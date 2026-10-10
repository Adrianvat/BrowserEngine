import { describe, expect, it } from "vitest";
import { imageNameFromFile, uniqueName } from "../../src/editor/image-names";

describe("uniqueName", () => {
  it("adds -2, -3… until the name is free", () => {
    expect(uniqueName("clip", [])).toBe("clip");
    expect(uniqueName("clip", ["clip"])).toBe("clip-2");
    expect(uniqueName("clip", ["clip", "clip-2"])).toBe("clip-3");
  });
});

describe("imageNameFromFile", () => {
  it("uses the file name without its extension, lowercase, with dashes", () => {
    expect(imageNameFromFile("Slime Sheet.png", [])).toBe("slime-sheet");
    expect(imageNameFromFile("hero.v2.png", [])).toBe("hero-v2");
    expect(imageNameFromFile("  --Coin__Gold!!.gif", [])).toBe("coin-gold");
    expect(imageNameFromFile("noext", [])).toBe("noext");
  });

  it("falls back to image when nothing usable is left", () => {
    expect(imageNameFromFile("!!!.png", [])).toBe("image");
    expect(imageNameFromFile(".png", [])).toBe("image");
  });

  it("never returns a taken name, built-in or uploaded", () => {
    expect(imageNameFromFile("hero.png", ["hero"])).toBe("hero-2");
    expect(imageNameFromFile("hero.png", ["hero", "hero-2"])).toBe("hero-3");
  });
});
