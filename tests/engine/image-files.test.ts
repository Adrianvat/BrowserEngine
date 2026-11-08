import { describe, expect, it } from "vitest";
import {
  collectImageFiles,
  extensionForType,
  formatStoredSheet,
  imageFile,
  imageFromFile,
  imageSource,
  isImageName,
  parseStoredSheet,
  sheetFile,
  sheetFromFile,
  toImageSources,
  validateStoredSheet,
  type ImageFile,
} from "../../src/engine";
import heroJson from "../../projects/demo/images/hero.json?raw";

const sheet = { frameWidth: 16, frameHeight: 16, animations: { walk: { frames: [0, 1], fps: 8 } } };

describe("image names and files", () => {
  it("accepts letters, digits, _ and -, nothing that could be a path", () => {
    for (const name of ["hero", "Slime2", "my_sprite", "slime-sheet"]) expect(isImageName(name)).toBe(true);
    for (const name of ["", "my sprite", "../hero", "a/b", "-x", ".hidden", "a.b"]) expect(isImageName(name)).toBe(false);
  });

  it("knows the image formats by extension and content type", () => {
    expect(extensionForType("image/png")).toBe("png");
    expect(extensionForType("image/svg+xml")).toBe("svg");
    expect(extensionForType("image/jpeg")).toBe("jpg");
    expect(extensionForType("IMAGE/PNG; charset=binary")).toBe("png");
    expect(extensionForType("text/plain")).toBeNull();
    expect(extensionForType("")).toBeNull();
  });

  it("names an image's files and reads them back from paths", () => {
    expect(imageFile("hero", "svg")).toBe("hero.svg");
    expect(sheetFile("hero")).toBe("hero.json");
    expect(imageFromFile("./hero.svg")).toEqual({ name: "hero", extension: "svg" });
    expect(imageFromFile("slime.PNG")).toEqual({ name: "slime", extension: "png" });
    expect(imageFromFile("src/game/images/coin.webp")).toEqual({ name: "coin", extension: "webp" });
    expect(imageFromFile("./hero.json")).toBeNull();
    expect(imageFromFile("./index.ts")).toBeNull();
    expect(imageFromFile("./my sprite.png")).toBeNull();
    expect(imageFromFile("./notes.txt")).toBeNull();
    expect(sheetFromFile("./hero.json")).toBe("hero");
    expect(sheetFromFile("hero.svg")).toBeNull();
  });
});

describe("sheet files", () => {
  it("checks a sheet's frame size and clips and returns a fresh copy", () => {
    const checked = validateStoredSheet(sheet);
    expect(checked).toEqual(sheet);
    expect(checked.animations.walk).not.toBe(sheet.animations.walk);
    expect(validateStoredSheet({ frameWidth: 8, frameHeight: 4 })).toEqual({ frameWidth: 8, frameHeight: 4, animations: {} });
    expect(validateStoredSheet({ ...sheet, animations: { go: { frames: [0], fps: 1, loop: false } } }).animations.go).toEqual({
      frames: [0],
      fps: 1,
      loop: false,
    });
  });

  it.each([
    [null, "A sheet must be an object"],
    [{ frameWidth: 0, frameHeight: 16 }, '"frameWidth" and "frameHeight" must be positive whole numbers'],
    [{ frameWidth: 16, frameHeight: 1.5 }, '"frameWidth" and "frameHeight" must be positive whole numbers'],
    [{ frameWidth: 16, frameHeight: 16, animations: [] }, '"animations" must be an object of clips'],
    [{ frameWidth: 16, frameHeight: 16, animations: { go: { frames: "0", fps: 1 } } }, 'Clip "go" must have "frames"'],
    [{ frameWidth: 16, frameHeight: 16, animations: { go: { frames: [0], fps: 1, loop: "yes" } } }, 'Clip "go" must have'],
  ])("rejects %j", (value, message) => {
    expect(() => validateStoredSheet(value)).toThrow(message);
  });

  it("writes a sheet one clip per line, as the demo's hero.json is written", () => {
    const text = formatStoredSheet({
      frameWidth: 16,
      frameHeight: 16,
      animations: { idle: { frames: [0, 1], fps: 2 }, walk: { frames: [2, 3, 4, 5], fps: 8, loop: false } },
    });
    expect(text).toBe(
      '{\n  "frameWidth": 16,\n  "frameHeight": 16,\n  "animations": {\n' +
        '    "idle": { "frames": [0, 1], "fps": 2 },\n' +
        '    "walk": { "frames": [2, 3, 4, 5], "fps": 8, "loop": false }\n  }\n}\n',
    );
    expect(formatStoredSheet({ frameWidth: 8, frameHeight: 4, animations: {} })).toBe(
      '{\n  "frameWidth": 8,\n  "frameHeight": 4,\n  "animations": {}\n}\n',
    );
    expect(formatStoredSheet(parseStoredSheet(heroJson))).toBe(heroJson.replace(/\r\n/g, "\n"));
  });

  it("parses a sheet file's text, reporting bad JSON", () => {
    expect(parseStoredSheet(JSON.stringify(sheet))).toEqual(sheet);
    expect(() => parseStoredSheet("{oops")).toThrow(/^not valid JSON: /);
  });
});

describe("collectImageFiles", () => {
  it("pairs image files with their sheets, by name, ignoring other files", () => {
    const images = collectImageFiles(
      { "./hero.svg": "/img/hero.svg", "./coin.png": "/img/coin.png", "./index.ts": "/index.ts" },
      { "./hero.json": JSON.stringify(sheet), "./stray.json": "{}" },
    );
    expect(images).toEqual([
      { name: "coin", url: "/img/coin.png" },
      { name: "hero", url: "/img/hero.svg", sheet },
    ]);
  });

  it("keeps an image whose sheet can't be read, with the error", () => {
    const [hero] = collectImageFiles({ "./hero.svg": "/hero.svg" }, { "./hero.json": "{oops" });
    expect(hero.sheet).toBeUndefined();
    expect(hero.error).toMatch(/^hero\.json: not valid JSON: /);
    const [coin] = collectImageFiles({ "./coin.png": "/coin.png" }, { "./coin.json": '{"frameWidth": 0}' });
    expect(coin.error).toBe('coin.json: "frameWidth" and "frameHeight" must be positive whole numbers');
  });

  it("keeps an image that has more than one file, with the error", () => {
    const [slime] = collectImageFiles({ "./slime.svg": "/slime.svg", "./slime.png": "/slime.png" }, {});
    expect(slime.url).toBe("/slime.png");
    expect(slime.error).toBe('"slime" has more than one file (slime.png, slime.svg); delete all but one');
  });
});

describe("image sources", () => {
  const hero: ImageFile = { name: "hero", url: "/hero.svg", sheet };
  const coin: ImageFile = { name: "coin", url: "/coin.png" };

  it("makes a sheet source or a plain URL for Assets", () => {
    expect(imageSource(hero)).toEqual({ url: "/hero.svg", ...sheet });
    expect(imageSource(coin)).toBe("/coin.png");
  });

  it("makes the sources of the image files", () => {
    expect(toImageSources([hero, coin])).toEqual({
      hero: { url: "/hero.svg", ...sheet },
      coin: "/coin.png",
    });
  });

  it("throws for an image file that can't be used, naming it", () => {
    expect(() => toImageSources([{ ...coin, error: "coin.json: not valid JSON: x" }])).toThrow(
      'Image "coin": coin.json: not valid JSON: x',
    );
  });
});
