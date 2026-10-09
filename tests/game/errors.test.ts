import { describe, it, expect } from "vitest";
import { drawError } from "../../src/game/errors";
import { recordingCanvas } from "../helpers/recording-canvas";

describe("drawError", () => {
  it("clears the canvas and writes the message in lines that fit", () => {
    const { canvas, calls } = recordingCanvas(232, 100); // (232 - 32) / 10 = 20 characters per line
    drawError(canvas, new Error("a".repeat(25)));
    expect(calls).toEqual([
      ["clearRect", 0, 0, 232, 100],
      ["fillText", "Failed to start:", 16, 32],
      ["fillText", "a".repeat(20), 16, 56],
      ["fillText", "a".repeat(5), 16, 80],
    ]);
  });

  it("handles thrown values that are not Errors", () => {
    const { canvas, calls } = recordingCanvas(232, 100);
    drawError(canvas, "boom");
    expect(calls.at(-1)).toEqual(["fillText", "boom", 16, 56]);
  });
});
