import * as engine from "../engine";
import type { LoadOptions, ModuleHost, ProjectSettings } from "../engine";

/** What scripts see as "engine": the engine module's namespace. */
export const scriptApi: Record<string, unknown> = { ...engine };

/** How every page loads a project's scripts, so they all check the same things. */
export function scriptLoadOptions(host: ModuleHost, settings: ProjectSettings): LoadOptions {
  return {
    engine: scriptApi,
    host,
    sceneNames: settings.scenes,
    // No components are defined in code; this still makes a script named like a built-in one an error.
    fixedComponents: [],
  };
}
