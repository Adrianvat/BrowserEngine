import { downloadTextFile, openPerfChannel } from "../engine";
import { mountCharts } from "../perf-viewer/chart-list";
import { formatTime, selectWindow, TIME_RANGES } from "../perf-viewer/time-window";
import { LiveFeed, type FeedStatus } from "./feed";

function element<T extends HTMLElement>(selector: string, type: new () => T): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Live page element not found: ${selector}`);
  return found;
}

const status = element("#status", HTMLElement);
const rangeSelect = element("#range", HTMLSelectElement);
const inputsCheckbox = element("#inputs", HTMLInputElement);
const pauseButton = element("#pause", HTMLButtonElement);
const clearButton = element("#clear", HTMLButtonElement);
const saveButton = element("#save", HTMLButtonElement);
const info = element("#info", HTMLElement);
const charts = mountCharts(element("#charts", HTMLElement));

/** How often the game is asked for frames (it stops sending 3 s after the last ask). */
const SUBSCRIBE_EVERY = 1000;
/** Charts are redrawn at most this often, in ms; the game's 60 frames a second would be waste. */
const REDRAW_EVERY = 100;

const WAITING_HINT =
  "Waiting for a game. Open the game page in another tab and keep it visible: browsers " +
  "pause a game in a background tab, so put this page in a separate window.";

const feed = new LiveFeed(openPerfChannel());
let paused = false;
let dirty = false;
let lastDraw = -Infinity;

for (const [index, range] of TIME_RANGES.entries()) {
  rangeSelect.append(new Option(range.label, String(index)));
}
rangeSelect.value = "0"; // the last minute

const STATUS_TEXT: Record<FeedStatus, () => string> = {
  waiting: () => "Waiting for a game",
  live: () => `Live · ${feed.scene} · ${feed.fps} fps`,
  stalled: () => "No frames coming in (is the game tab in the background?)",
  stopped: () => "The game stopped",
};

function updateStatus(): void {
  const state = feed.status;
  status.textContent = STATUS_TEXT[state]();
  status.className = `status ${state}`;
  const data = feed.data;
  info.textContent = data
    ? `${feed.length} frames over ${formatTime(data.end - data.start)}` +
      (paused ? " · paused" : "")
    : "";
}

function redraw(): void {
  const data = feed.data;
  if (!data) {
    charts.showMessage(WAITING_HINT);
    return;
  }
  const range = TIME_RANGES[Number(rangeSelect.value)]?.ms ?? null;
  charts.redraw(data, selectWindow(data, range, 1), inputsCheckbox.checked);
}

/** Redraws when there is something new, but not more often than REDRAW_EVERY. */
function tick(now: number): void {
  updateStatus();
  if (dirty && !paused && now - lastDraw >= REDRAW_EVERY) {
    dirty = false;
    lastDraw = now;
    redraw();
  }
  requestAnimationFrame(tick);
}

feed.onChange(() => {
  dirty = true;
});
rangeSelect.addEventListener("change", redraw);
inputsCheckbox.addEventListener("change", redraw);
window.addEventListener("resize", redraw);
pauseButton.addEventListener("click", () => {
  paused = !paused;
  pauseButton.textContent = paused ? "Resume" : "Pause";
  if (!paused) redraw();
});
clearButton.addEventListener("click", () => {
  feed.clear();
  redraw();
});
saveButton.addEventListener("click", () => {
  if (feed.length === 0) return;
  const file = feed.toFile();
  downloadTextFile(file.name, file.contents, "text/csv");
});
window.addEventListener("pagehide", () => feed.close());

feed.subscribe();
setInterval(() => feed.subscribe(), SUBSCRIBE_EVERY);
redraw();
requestAnimationFrame(tick);
