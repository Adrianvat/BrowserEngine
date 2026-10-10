/** `base` if it is free, otherwise the first free `base-2`, `base-3`… */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** A name for an uploaded file: "Slime Sheet.png" becomes "slime-sheet". */
export function imageNameFromFile(fileName: string, taken: Iterable<string>): string {
  const base =
    fileName
      .replace(/\.[^.]*$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "image";
  return uniqueName(base, taken);
}
