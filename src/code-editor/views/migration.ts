import { parseScripts, type Script } from "../../engine";
import type { ScriptLibrary } from "../library";

/** Where an older version of the editor kept the scripts: this browser's storage. */
export const LEGACY_KEY = "browser-engine:scripts";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Scripts are files in the project now. Scripts a previous version saved in the browser
 * are offered for import once, so that work is not lost, then forgotten either way.
 */
export function mountMigration(
  root: HTMLElement,
  library: ScriptLibrary,
  storage: Pick<Storage, "getItem" | "removeItem"> | null,
): void {
  root.replaceChildren();
  if (!storage || library.readOnly || library.loadError !== null) return;
  const text = storage.getItem(LEGACY_KEY);
  if (text === null) return;
  let saved: Script[];
  try {
    saved = parseScripts(text);
  } catch {
    storage.removeItem(LEGACY_KEY);
    return;
  }

  const message = document.createElement("span");
  message.textContent =
    `${saved.length} script${saved.length === 1 ? "" : "s"} saved in this browser by an earlier ` +
    "version of the editor were found. Scripts are files of the project now (its scripts folder under projects/). " +
    "Import them, replacing the files with the same names?";
  const forget = () => {
    storage.removeItem(LEGACY_KEY);
    root.replaceChildren();
  };
  const doImport = document.createElement("button");
  doImport.textContent = "Import";
  doImport.addEventListener("click", () => {
    doImport.disabled = true;
    library.importScripts(saved).then(forget, (error: unknown) => {
      message.textContent = `Couldn't import: ${messageOf(error)}`;
      doImport.disabled = false;
    });
  });
  const discard = document.createElement("button");
  discard.textContent = "Discard them";
  discard.addEventListener("click", forget);
  root.replaceChildren(message, doImport, discard);
}
