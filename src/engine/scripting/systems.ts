import type { Scene } from "../scene/scene";
import type { LoadedScene, LoadedSystem } from "./loader";

/**
 * The scenes of a project, by name in the project's order: each one's setup is its scene
 * script's, when it has one; a scene without a script starts with its data alone.
 */
export function scenesFromScripts(
  sceneNames: readonly string[],
  scenes: readonly LoadedScene[],
): Record<string, Scene> {
  const result: Record<string, Scene> = {};
  for (const name of sceneNames) {
    result[name] = scenes.find((loaded) => loaded.name === name)?.scene ?? { setup() {} };
  }
  return result;
}

/** Whether a loaded system belongs in the named scene. */
export function runsIn(system: LoadedSystem, scene: string): boolean {
  return system.scenes === null || system.scenes.includes(scene);
}

/**
 * The same scenes, each also running the script systems that belong to it (the disabled
 * ones left out): after the scene's own setup, in script order, under the script's name
 * and with its hooks, so scripts can switch each other on and off by name (Systems).
 * Update systems run at the fixed step; "render" phase systems run once per frame after
 * the built-in renderer.
 */
export function withScriptSystems(
  scenes: Readonly<Record<string, Scene>>,
  systems: readonly LoadedSystem[],
): Record<string, Scene> {
  const result: Record<string, Scene> = {};
  for (const [name, scene] of Object.entries(scenes)) {
    const own = systems.filter((system) => !system.disabled && runsIn(system, name));
    result[name] = {
      setup(context) {
        scene.setup(context);
        for (const loaded of own) {
          const definition = {
            name: loaded.name,
            run: loaded.system,
            startsEnabled: loaded.startsEnabled,
            onEnable: loaded.onEnable ?? undefined,
            onDisable: loaded.onDisable ?? undefined,
          };
          if (loaded.phase === "render") context.addRenderSystem(definition);
          else context.addSystem(definition);
        }
      },
    };
  }
  return result;
}
