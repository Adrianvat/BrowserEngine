import { describe, expect, it } from "vitest";
import { History } from "../../src/sprite-editor/history";

describe("History", () => {
  it("undoes and redoes in order", () => {
    const history = new History<string>();
    expect(history.canUndo).toBe(false);
    history.push("a");
    history.push("b");
    expect(history.canUndo).toBe(true);
    expect(history.undo("c")).toBe("b");
    expect(history.undo("b")).toBe("a");
    expect(history.undo("a")).toBeNull();
    expect(history.canRedo).toBe(true);
    expect(history.redo("a")).toBe("b");
    expect(history.redo("b")).toBe("c");
    expect(history.redo("c")).toBeNull();
  });

  it("drops the redo states once something new is pushed", () => {
    const history = new History<string>();
    history.push("a");
    history.undo("b");
    history.push("x");
    expect(history.canRedo).toBe(false);
    expect(history.undo("y")).toBe("x");
  });

  it("forgets the oldest states past its limit", () => {
    const history = new History<number>(2);
    history.push(1);
    history.push(2);
    history.push(3);
    expect(history.undo(4)).toBe(3);
    expect(history.undo(3)).toBe(2);
    expect(history.undo(2)).toBeNull();
  });

  it("clears everything", () => {
    const history = new History<number>();
    history.push(1);
    history.undo(2);
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});
