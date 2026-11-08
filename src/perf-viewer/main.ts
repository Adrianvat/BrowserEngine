import { mountCharts } from "./chart-list";
import { parsePerfLog, type PerfLogData } from "./log-file";
import { canScroll, formatTime, selectWindow, TIME_RANGES } from "./time-window";

function element<T extends HTMLElement>(selector: string, type: new () => T): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Viewer element not found: ${selector}`);
  return found;
}

const fileInput = element("#file", HTMLInputElement);
const rangeSelect = element("#range", HTMLSelectElement);
const offsetInput = element("#offset", HTMLInputElement);
const inputsCheckbox = element("#inputs", HTMLInputElement);
const info = element("#info", HTMLElement);
const message = element("#message", HTMLElement);
const charts = mountCharts(element("#charts", HTMLElement));

/** The slider's resolution: its value is a fraction of this. */
const OFFSET_STEPS = Number(offsetInput.max);

const EMPTY_HINT =
  "Choose a log file (or drop one here). The game writes one whenever its performance " +
  "overlay is hidden after being shown: press F3 in the game to start and stop logging.";

let log: PerfLogData | null = null;
let logName = "";

for (const [index, range] of TIME_RANGES.entries()) {
  rangeSelect.append(new Option(range.label, String(index)));
}
rangeSelect.value = String(TIME_RANGES.length - 1);

function redraw(): void {
  if (!log) return;
  const range = TIME_RANGES[Number(rangeSelect.value)]?.ms ?? null;
  offsetInput.disabled = !canScroll(log, range);
  const window = selectWindow(log, range, Number(offsetInput.value) / OFFSET_STEPS);
  const shown = charts.redraw(log, window, inputsCheckbox.checked);
  const span = `${formatTime(window.from - log.start)} – ${formatTime(window.to - log.start)}`;
  info.textContent =
    `${logName}: ${log.rows.length} frames over ${formatTime(log.end - log.start)}` +
    ` · showing ${span} (${shown} frames)`;
}

async function openFile(file: File): Promise<void> {
  message.textContent = "";
  try {
    log = parsePerfLog(await file.text());
    logName = file.name;
    charts.build(log);
    offsetInput.value = offsetInput.max; // the latest data first
    redraw();
  } catch (error) {
    log = null;
    logName = "";
    info.textContent = "";
    charts.showMessage(EMPTY_HINT);
    message.textContent = `Cannot read ${file.name}: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void openFile(file);
});
rangeSelect.addEventListener("change", redraw);
offsetInput.addEventListener("input", redraw);
inputsCheckbox.addEventListener("change", redraw);
window.addEventListener("resize", redraw);

// Dropping a file anywhere on the page opens it too.
const chartsElement = element("#charts", HTMLElement);
document.addEventListener("dragover", (event) => {
  event.preventDefault();
  chartsElement.classList.add("drop");
});
document.addEventListener("dragleave", () => chartsElement.classList.remove("drop"));
document.addEventListener("drop", (event) => {
  event.preventDefault();
  chartsElement.classList.remove("drop");
  const file = event.dataTransfer?.files[0];
  if (file) void openFile(file);
});

charts.showMessage(EMPTY_HINT);
