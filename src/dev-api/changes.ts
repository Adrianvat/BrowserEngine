/**
 * What the dev server sends over Vite's websocket when a file in a project changes on
 * disk (see tools/game-files-plugin.ts), whoever changed it: an editor, another tab, or
 * another program.
 */
export interface FilesChange {
  /** The project's id (its folder name). */
  project: string;
  /** "settings" is the project's project.json (added, changed or deleted). */
  folder: "scripts" | "scenes" | "images" | "settings";
  /** The watcher's event: "add", "change", "unlink"… */
  event: string;
  /** The file's path inside the folder, e.g. "systems/kick.js" or "slime.png"; "" for settings. */
  file: string;
}

export const FILES_CHANGED_EVENT = "browser-engine:files-changed";

const FOLDERS: readonly string[] = ["scripts", "scenes", "images", "settings"];

function isFilesChange(data: unknown): data is FilesChange {
  if (typeof data !== "object" || data === null) return false;
  const { project, folder, event, file } = data as Record<string, unknown>;
  return (
    typeof project === "string" &&
    typeof folder === "string" &&
    FOLDERS.includes(folder) &&
    typeof event === "string" &&
    typeof file === "string"
  );
}

/** The part of Vite's `import.meta.hot` that is used, so tests can stand in for it. */
export interface HotEvents {
  on(event: string, listener: (data: unknown) => void): void;
}

/**
 * Calls `listener` with the changes in `folder` of `project` (any project, for null), a
 * little after the last of a burst of them (a save often touches two files). `hot` is
 * Vite's `import.meta.hot`; without it (no dev server) nothing happens.
 */
export function subscribeFilesChanged(
  hot: HotEvents | undefined,
  project: string | null,
  folder: FilesChange["folder"],
  listener: (changes: FilesChange[]) => void,
  delay = 100,
): void {
  if (!hot) return;
  let pending: FilesChange[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  hot.on(FILES_CHANGED_EVENT, (data: unknown) => {
    if (!isFilesChange(data) || data.folder !== folder) return;
    if (project !== null && data.project !== project) return;
    pending.push(data);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const changes = pending;
      pending = [];
      listener(changes);
    }, delay);
  });
}

/** subscribeFilesChanged on this page's dev-server connection. */
export function onFilesChanged(
  project: string | null,
  folder: FilesChange["folder"],
  listener: (changes: FilesChange[]) => void,
): void {
  subscribeFilesChanged(import.meta.hot, project, folder, listener);
}
