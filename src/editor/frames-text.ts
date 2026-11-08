/** "2, 3, 4" (commas and/or spaces) as numbers; null if a part isn't a whole number. */
export function parseFrames(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter((part) => part !== "");
  if (!parts.every((part) => /^-?\d+$/.test(part))) return null;
  return parts.map(Number);
}

export function formatFrames(frames: readonly number[]): string {
  return frames.join(", ");
}
