import { onFilesChanged } from "../dev-api/changes";
import { ImagesApi } from "../dev-api/images";
import { projectApiBase } from "../dev-api/projects";
import { currentProject } from "../project/current";
import { PixelWorkspace } from "./pixel-workspace";
import { SpriteLibrary } from "./sprite-library";
import { mountTopBar } from "./views/top-bar";
import { EditorShell } from "./workspace";

function element<T extends HTMLElement>(selector: string, type: new () => T): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Sprite editor element not found: ${selector}`);
  return found;
}

/** Downloads an image's file the way the engine does, with a clear error for a wrong path. */
async function fetchFile(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error(`Expected an image but got ${type || "an unknown content type"}`);
  return response.blob();
}

// The images are the project's files, read and written through the dev server
// (tools/game-files-plugin.ts). Without it (a production build) the copies bundled with
// the page can be opened but not saved. Even imported lazily, the bundle counts as a
// dependency for Vite: without accepting its hot updates here, every saved file would
// reload this whole page (and lose the drawing). Nothing to do in the callback: the
// list is re-read when the dev server says the files changed (below).
import.meta.hot?.accept("../project/bundle", () => {});

// /sprite-editor.html?project=demo edits that project's images; without it, the one
// last picked in the scene editor, or else the first project's.
const current = await currentProject();
if (current === null) {
  document.body.textContent = "There are no projects; make one in the scene editor (/editor.html).";
  throw new Error("No projects");
}
const project = current.id;
const library = new SpriteLibrary({
  files: new ImagesApi(projectApiBase(project, "images")),
  fallback: async () => (await import("../project/bundle")).bundledProjects[project]?.imageFiles ?? [],
  fetchFile,
});

const topBarRoot = element("#topbar", HTMLElement);
const mounts = {
  tools: element("#tools", HTMLElement),
  view: element("#view", HTMLElement),
  frames: element("#frames", HTMLElement),
  animation: element("#animation", HTMLElement),
};
// The status line lives in the top bar, which is mounted next; messages before that are rare.
let report: (message: string, kind?: "" | "error" | "saved") => void = () => {};
const shell = new EditorShell(new PixelWorkspace(), mounts, (message, kind) => report(message, kind));
const topBar = mountTopBar(topBarRoot, shell, library, {
  projectId: project,
  projectName: current.settings.name || project,
});
report = topBar.report;

// Image files changed on disk (saved or deleted in the scene editor, another tab, or
// another program) show up in Open.
onFilesChanged(project, "images", () => void topBar.refresh());

// /sprite-editor.html?image=slime opens that image (the scene editor links here).
const requested = new URLSearchParams(location.search).get("image");
if (requested) await topBar.open(requested);
