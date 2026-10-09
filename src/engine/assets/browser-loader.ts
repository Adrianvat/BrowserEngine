/**
 * Default image loader. Downloads the file first so failures say why
 * (HTTP status, wrong content type, SVG without a size), then decodes it.
 */
export async function loadBrowserImage(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) {
    // Dev servers often answer unknown paths with their HTML page instead of a 404.
    throw new Error(`Expected an image but got ${type || "an unknown content type"}`);
  }
  const blob = await response.blob();
  // Browsers give an SVG without width/height a made-up size (Chrome: 300x150),
  // which would silently break frame math, so require an explicit size.
  if (type.startsWith("image/svg+xml") && !svgHasSize(await blob.text())) {
    throw new Error(
      "SVG has no width/height in pixels; add width and height attributes to its root <svg>",
    );
  }

  const image = new Image();
  // The object URL is kept alive for as long as the image may be drawn.
  image.src = URL.createObjectURL(blob);
  await image.decode();
  return image;
}

/** True if the root <svg> element has positive width and height in pixels. */
export function svgHasSize(svg: string): boolean {
  const root = /<svg\b([^>]*)>/i.exec(svg);
  if (!root) return false;
  return isPixelSize(attribute(root[1], "width")) && isPixelSize(attribute(root[1], "height"));
}

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(String.raw`(?:^|\s)${name}\s*=\s*["']([^"']*)["']`).exec(attributes);
  return match?.[1];
}

function isPixelSize(value: string | undefined): boolean {
  if (value === undefined) return false;
  const match = /^\s*(\d*\.?\d+)(px)?\s*$/.exec(value);
  return match !== null && Number(match[1]) > 0;
}
