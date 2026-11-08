/** One pixel's color: red, green, blue, alpha, each 0–255. */
export type Rgba = readonly [number, number, number, number];

export const TRANSPARENT: Rgba = [0, 0, 0, 0];

/** "#rrggbb" to an opaque color; null for anything else. */
export function parseHex(text: string): Rgba | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

/** The color as "#rrggbb" (alpha is left out). */
export function toHex([r, g, b]: Rgba): string {
  return "#" + [r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("");
}

export function sameColor(a: Rgba, b: Rgba): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** The colors the palette starts with (the PICO-8 palette, a common pixel-art set). */
export const PALETTE: readonly string[] = [
  "#000000",
  "#1d2b53",
  "#7e2553",
  "#008751",
  "#ab5236",
  "#5f574f",
  "#c2c3c7",
  "#fff1e8",
  "#ff004d",
  "#ffa300",
  "#ffec27",
  "#00e436",
  "#29adff",
  "#83769c",
  "#ff77a8",
  "#ffccaa",
];
