import { isProjectId } from "../engine";

/**
 * Which project a page is on: the `project` parameter in its URL, or else the first
 * project there is. Links between the pages carry the parameter along.
 */
export function projectIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get("project");
  return id !== null && isProjectId(id) ? id : null;
}

/** The project a page opens when its URL names none: the first by id. */
export function defaultProjectId(ids: readonly string[]): string | null {
  return [...ids].sort()[0] ?? null;
}

/**
 * Which project the scene editor's picker last chose, so the other pages open the same
 * one when their own URL does not name one (bookmarked, say, or the game's plain "/").
 * This is the one thing kept in this browser's storage: which project to default to is
 * a per-browser convenience, not project data, so it does not belong in a file the
 * editor would write and git would carry between machines.
 */
const CURRENT_PROJECT_KEY = "browser-engine:current-project";

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The project remembered from the scene editor, kept only while it still exists. */
export function rememberedProjectId(ids: readonly string[]): string | null {
  let id: string | null = null;
  try {
    id = storage()?.getItem(CURRENT_PROJECT_KEY) ?? null;
  } catch {
    id = null;
  }
  return id !== null && ids.includes(id) ? id : null;
}

/** Remembers the project the scene editor is showing, for rememberedProjectId. */
export function rememberProjectId(id: string): void {
  try {
    storage()?.setItem(CURRENT_PROJECT_KEY, id);
  } catch {
    // No browser storage (private browsing, a sandboxed frame): defaults fall back to
    // the first project instead; nothing else depends on this.
  }
}

/**
 * Which project a page opens when its URL does not say: the one last picked in the
 * scene editor, or else the first by id.
 */
export function resolveProjectId(search: string, ids: readonly string[]): string | null {
  return projectIdFromSearch(search) ?? rememberedProjectId(ids) ?? defaultProjectId(ids);
}

/** A page's URL for a project, e.g. pageUrl("/editor.html", "demo") -> "/editor.html?project=demo". */
export function pageUrl(page: string, projectId: string | null, params: Record<string, string> = {}): string {
  const search = new URLSearchParams(params);
  if (projectId !== null) search.set("project", projectId);
  const query = search.toString();
  return query === "" ? page : `${page}?${query}`;
}

/** A project id for a name: "My Game" becomes "my-game"; "" when nothing usable is left. */
export function projectIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
