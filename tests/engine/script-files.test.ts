import { describe, it, expect } from "vitest";
import {
  arrangeScripts,
  parseScriptOrder,
  scriptFile,
  scriptFromFile,
} from "../../src/engine";

describe("script files", () => {
  it("names a script's file and reads a file's script", () => {
    expect(scriptFile("system", "kick")).toBe("systems/kick.js");
    expect(scriptFile("component", "Player")).toBe("components/Player.js");
    expect(scriptFromFile("systems/kick.js")).toEqual({ kind: "system", name: "kick" });
    expect(scriptFromFile("./components/Player.js")).toEqual({ kind: "component", name: "Player" });
    expect(scriptFile("scene", "play")).toBe("scenes/play.js");
    expect(scriptFromFile("./scenes/play.js")).toEqual({ kind: "scene", name: "play" });
    expect(scriptFromFile("/abs/path/src/game/scripts/systems/kick.js")).toEqual({ kind: "system", name: "kick" });
    expect(scriptFromFile("systems/kick.ts")).toBeNull();
    expect(scriptFromFile("systems/2fast.js")).toBeNull();
    expect(scriptFromFile("systems/sub/kick.js")).toBeNull();
    expect(scriptFromFile("things/kick.js")).toBeNull();
    expect(scriptFromFile("order.json")).toBeNull();
  });

  it("reads an order file leniently", () => {
    expect(parseScriptOrder({ systems: ["b", "a", "b", 3, "no way"] })).toEqual({ systems: ["b", "a"], disabled: [] });
    expect(parseScriptOrder({ systems: ["a"], disabled: ["a", "x y", "c"] })).toEqual({ systems: ["a"], disabled: ["a", "c"] });
    expect(parseScriptOrder({})).toEqual({ systems: [], disabled: [] });
    expect(parseScriptOrder(null)).toEqual({ systems: [], disabled: [] });
    expect(parseScriptOrder("x")).toEqual({ systems: [], disabled: [] });
  });

  it("arranges files into the script list: ordered systems, the rest by name, components, then scenes by name", () => {
    const files = {
      "./systems/b.js": "B",
      "./systems/a.js": "A",
      "./systems/c.js": "C",
      "./components/Zed.js": "Z",
      "./components/Alpha.js": "α",
      "./scenes/title.js": "T",
      "./scenes/play.js": "P",
      "./README.md": "no",
      "./systems/notes.txt": "no",
    };
    const scripts = arrangeScripts(files, { systems: ["c", "missing", "a"], disabled: ["a", "missing"] });
    expect(scripts).toEqual([
      { kind: "system", name: "c", code: "C" },
      { kind: "system", name: "a", code: "A", disabled: true },
      { kind: "system", name: "b", code: "B" },
      { kind: "component", name: "Alpha", code: "α" },
      { kind: "component", name: "Zed", code: "Z" },
      { kind: "scene", name: "play", code: "P" },
      { kind: "scene", name: "title", code: "T" },
    ]);
    expect(arrangeScripts({}, { systems: [], disabled: [] })).toEqual([]);
  });
});
