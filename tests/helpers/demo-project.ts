import {
  dataUrlHost,
  describeScriptErrors,
  loadScripts,
  parseProjectSettings,
  type ComponentType,
  type LoadedScene,
  type LoadedScripts,
  type LoadedSystem,
  type ProjectSettings,
  type Scene,
  type System,
} from "../../src/engine";
import { bundledProjects } from "../../src/project/bundle";
import type { BundledProject } from "../../src/project/collect";
import { scriptLoadOptions } from "../../src/project/scripts";

/** The demo project (projects/demo), as bundled with the pages. */
export function demoProject(): BundledProject {
  const project = bundledProjects.demo;
  if (!project) throw new Error("The demo project is missing from projects/");
  return project;
}

export function demoSettings(): ProjectSettings {
  return parseProjectSettings(demoProject().settingsText);
}

let loading: Promise<LoadedScripts> | null = null;

/** The demo project's scripts, loaded once for all tests; fails if any of them is broken. */
export function demoScripts(): Promise<LoadedScripts> {
  loading ??= loadScripts(demoProject().scripts, scriptLoadOptions(dataUrlHost, demoSettings())).then(
    (loaded) => {
      if (loaded.errors.length > 0) throw new Error(describeScriptErrors(loaded.errors));
      return loaded;
    },
  );
  return loading;
}

export async function loadedSystem(name: string): Promise<LoadedSystem> {
  const found = (await demoScripts()).systems.find((system) => system.name === name);
  if (!found) throw new Error(`No system script "${name}"`);
  return found;
}

export async function system(name: string): Promise<System> {
  return (await loadedSystem(name)).system;
}

export async function loadedScene(name: string): Promise<LoadedScene> {
  const found = (await demoScripts()).scenes.find((scene) => scene.name === name);
  if (!found) throw new Error(`No scene script "${name}"`);
  return found;
}

export async function scene(name: string): Promise<Scene> {
  return (await loadedScene(name)).scene;
}

export async function componentClass<T = object>(name: string): Promise<ComponentType<T>> {
  const found = (await demoScripts()).components.find((component) => component.name === name);
  if (!found) throw new Error(`No component script "${name}"`);
  return found.definition.type as ComponentType<T>;
}
