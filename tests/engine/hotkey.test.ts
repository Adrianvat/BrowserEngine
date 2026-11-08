import { describe, expect, it } from "vitest";
import { formatHotkey, matchesHotkey, parseHotkey } from "../../src/engine/perf/hotkey";

describe("parseHotkey", () => {
  it("parses a bare key", () => {
    expect(parseHotkey("F3")).toEqual({
      code: "F3",
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    });
  });

  it("parses modifiers in any order and case", () => {
    expect(parseHotkey("Shift+Ctrl+KeyP")).toEqual({
      code: "KeyP",
      ctrl: true,
      shift: true,
      alt: false,
      meta: false,
    });
    expect(parseHotkey("alt+META+F1")).toMatchObject({ code: "F1", alt: true, meta: true });
  });

  it("accepts the other names of the modifiers", () => {
    expect(parseHotkey("Control+Option+Cmd+F1")).toMatchObject({
      ctrl: true,
      alt: true,
      meta: true,
    });
    expect(parseHotkey("Command+F1")).toMatchObject({ meta: true });
  });

  it("ignores spaces around the parts", () => {
    expect(parseHotkey(" Shift + F3 ")).toMatchObject({ code: "F3", shift: true });
  });

  it("keeps the key code's case (codes are case-sensitive)", () => {
    expect(parseHotkey("Shift+f3").code).toBe("f3");
  });

  it("rejects a hotkey without a key code", () => {
    expect(() => parseHotkey("")).toThrow('Hotkey "" needs a key code');
    expect(() => parseHotkey("Shift+")).toThrow("needs a key code");
    expect(() => parseHotkey("+F3")).toThrow("needs a key code");
  });

  it("rejects unknown and repeated modifiers", () => {
    expect(() => parseHotkey("Super+F3")).toThrow('unknown modifier "Super"');
    // "Shift" alone reads as the key code "Shift" with the modifier Shift: not a modifier error.
    expect(() => parseHotkey("Shift+Shift+F3")).toThrow('modifier "Shift" is repeated');
  });
});

describe("matchesHotkey", () => {
  const shiftF3 = parseHotkey("Shift+F3");

  it("matches the key with exactly its modifiers", () => {
    expect(matchesHotkey(shiftF3, { code: "F3", shiftKey: true })).toBe(true);
    expect(matchesHotkey(shiftF3, { code: "F3", shiftKey: true, ctrlKey: false })).toBe(true);
  });

  it("does not match with missing or extra modifiers", () => {
    expect(matchesHotkey(shiftF3, { code: "F3" })).toBe(false);
    expect(matchesHotkey(shiftF3, { code: "F3", shiftKey: true, ctrlKey: true })).toBe(false);
    expect(matchesHotkey(parseHotkey("F3"), { code: "F3", shiftKey: true })).toBe(false);
  });

  it("does not match another key, or an event without a code", () => {
    expect(matchesHotkey(shiftF3, { code: "F4", shiftKey: true })).toBe(false);
    expect(matchesHotkey(shiftF3, { shiftKey: true })).toBe(false);
  });
});

describe("formatHotkey", () => {
  it("writes the modifiers in a fixed order, then the key", () => {
    expect(formatHotkey(parseHotkey("meta+alt+shift+ctrl+KeyA"))).toBe("Ctrl+Shift+Alt+Meta+KeyA");
    expect(formatHotkey(parseHotkey("F3"))).toBe("F3");
  });
});
