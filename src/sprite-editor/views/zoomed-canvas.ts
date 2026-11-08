const MIN_ZOOM = 1;
const MAX_ZOOM = 48;
/** Grid lines are drawn only once the pixels are big enough for them to help. */
const GRID_FROM_ZOOM = 4;

export interface ZoomedCanvas {
  zoomIn(): void;
  zoomOut(): void;
  /** Picks the biggest zoom that shows the whole frame in its container. */
  fit(): void;
  toggleGrid(): void;
  /** Shows the previous frame faintly under the current one, to line animation up. */
  toggleOnionSkin(): void;
  /** Repaints at the next animation frame, however many times it is asked before then. */
  redraw(): void;
  readonly grid: boolean;
  readonly onionSkin: boolean;
  readonly zoom: number;
}

/**
 * A canvas that shows a frame of `size()` pixels at a whole-number zoom, refitting when
 * the frame size or window changes, zooming with the wheel. `paint` draws the content
 * (it gets the zoom; the pixel grid is its call via drawGrid). Stops when `signal` aborts.
 */
export function createZoomedCanvas(
  element: HTMLCanvasElement,
  size: () => { width: number; height: number },
  paint: (ctx: CanvasRenderingContext2D, zoom: number, view: ZoomedCanvas) => void,
  signal: AbortSignal,
): ZoomedCanvas {
  const ctx = element.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available in this browser");
  let zoom = 1;
  let grid = true;
  let onionSkin = false;
  let frame = 0;

  const draw = () => {
    frame = 0;
    const { width, height } = size();
    const w = width * zoom;
    const h = height * zoom;
    if (element.width !== w || element.height !== h) {
      element.width = w;
      element.height = h;
      element.style.width = `${w}px`;
      element.style.height = `${h}px`;
    }
    ctx.clearRect(0, 0, w, h);
    paint(ctx, zoom, view);
  };

  const redraw = () => {
    if (frame === 0 && !signal.aborted) frame = requestAnimationFrame(draw);
  };

  const setZoom = (next: number) => {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next)));
    redraw();
  };

  const fit = () => {
    const container = element.parentElement;
    const { width, height } = size();
    if (!container) return setZoom(8);
    const room = 32;
    setZoom(Math.floor(Math.min((container.clientWidth - room) / width, (container.clientHeight - room) / height)));
  };

  element.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round(zoom / 8)));
    },
    { passive: false, signal },
  );
  window.addEventListener("resize", fit, { signal });

  const view: ZoomedCanvas = {
    zoomIn: () => setZoom(zoom + Math.max(1, Math.round(zoom / 4))),
    zoomOut: () => setZoom(zoom - Math.max(1, Math.round(zoom / 4))),
    fit,
    toggleGrid: () => {
      grid = !grid;
      redraw();
    },
    toggleOnionSkin: () => {
      onionSkin = !onionSkin;
      redraw();
    },
    redraw,
    get grid() {
      return grid;
    },
    get onionSkin() {
      return onionSkin;
    },
    get zoom() {
      return zoom;
    },
  };
  fit();
  return view;
}

/** Faint lines between the pixels, once the zoom makes them worth it. */
export function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, zoom: number): void {
  if (zoom < GRID_FROM_ZOOM) return;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < width; x++) {
    ctx.moveTo(x * zoom + 0.5, 0);
    ctx.lineTo(x * zoom + 0.5, height * zoom);
  }
  for (let y = 1; y < height; y++) {
    ctx.moveTo(0, y * zoom + 0.5);
    ctx.lineTo(width * zoom, y * zoom + 0.5);
  }
  ctx.stroke();
}

/** Refits the view whenever the frame size changes, and repaints on every change. */
export function followDocument(
  view: ZoomedCanvas,
  doc: { onChange(listener: () => void): void; readonly width: number; readonly height: number },
  onChange: () => void = () => {},
): void {
  let lastSize = `${doc.width}x${doc.height}`;
  doc.onChange(() => {
    const size = `${doc.width}x${doc.height}`;
    if (size !== lastSize) {
      lastSize = size;
      view.fit();
    }
    onChange();
    view.redraw();
  });
}
