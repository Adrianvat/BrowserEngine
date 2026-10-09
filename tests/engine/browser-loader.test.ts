import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBrowserImage, svgHasSize } from "../../src/engine/assets/browser-loader";

describe("svgHasSize", () => {
  it("accepts absolute width and height on the root <svg>", () => {
    expect(svgHasSize('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16" viewBox="0 0 32 16">')).toBe(true);
    expect(svgHasSize("<?xml version='1.0'?>\n<svg height='16px' width='32.5px'></svg>")).toBe(true);
  });

  it("rejects missing, percentage, or zero sizes", () => {
    expect(svgHasSize('<svg viewBox="0 0 32 16"></svg>')).toBe(false);
    expect(svgHasSize('<svg width="100%" height="100%"></svg>')).toBe(false);
    expect(svgHasSize('<svg width="0" height="16"></svg>')).toBe(false);
    expect(svgHasSize('<svg width="32"></svg>')).toBe(false);
  });

  it("ignores lookalike attributes and child elements", () => {
    expect(svgHasSize('<svg stroke-width="2" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>')).toBe(false);
  });
});

class FakeImage {
  src = "";
  decode = vi.fn(async () => {});
}

function serve(body: string, init: ResponseInit): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, init)));
}

describe("loadBrowserImage", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports HTTP errors with their status", async () => {
    serve("nope", { status: 404, statusText: "Not Found" });
    await expect(loadBrowserImage("/missing.png")).rejects.toThrow("HTTP 404 Not Found");
  });

  it("reports non-image responses, such as a dev server's HTML fallback page", async () => {
    serve("<!doctype html>", { headers: { "Content-Type": "text/html" } });
    await expect(loadBrowserImage("/typo.png")).rejects.toThrow(
      "Expected an image but got text/html",
    );
  });

  it("rejects SVGs without a width and height in pixels", async () => {
    serve('<svg viewBox="0 0 8 8"></svg>', { headers: { "Content-Type": "image/svg+xml" } });
    await expect(loadBrowserImage("/logo.svg")).rejects.toThrow(
      "SVG has no width/height in pixels; add width and height attributes to its root <svg>",
    );
  });

  it("decodes the downloaded image", async () => {
    serve('<svg width="8" height="8"></svg>', { headers: { "Content-Type": "image/svg+xml" } });
    const image = (await loadBrowserImage("/ok.svg")) as unknown as FakeImage;
    expect(image).toBeInstanceOf(FakeImage);
    expect(image.src).toMatch(/^blob:/);
    expect(image.decode).toHaveBeenCalled();
  });
});
