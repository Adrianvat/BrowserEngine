import type { SceneFilesClient } from "../../src/dev-api/scenes";
import { formatSceneData, type SceneData, type SceneFile } from "../../src/engine";

/** Stands in for the dev server's scene files: JSON text per scene, every call logged, failures on demand. */
export class FakeSceneFiles implements SceneFilesClient {
  readonly texts = new Map<string, string>();
  readonly calls: string[] = [];
  /** When set, every call fails with this message. */
  failure: string | null = null;
  /** When false, load() fails as if there were no dev server. */
  reachable = true;

  constructor(initial: Record<string, string> = {}) {
    for (const [name, text] of Object.entries(initial)) this.texts.set(name, text);
  }

  async load(): Promise<SceneFile[]> {
    this.calls.push("load");
    if (!this.reachable) throw new Error("/api/scenes is not there");
    this.check();
    return [...this.texts].map(([name, text]) => ({ name, text })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async write(name: string, data: SceneData): Promise<void> {
    this.calls.push(`write ${name}`);
    this.check();
    this.texts.set(name, formatSceneData(data));
  }

  async remove(name: string): Promise<void> {
    this.calls.push(`remove ${name}`);
    this.check();
    this.texts.delete(name);
  }

  /** A scene's file, parsed, or null when there is none. */
  dataOf(name: string): SceneData | null {
    const text = this.texts.get(name);
    return text === undefined ? null : (JSON.parse(text) as SceneData);
  }

  private check(): void {
    if (this.failure !== null) throw new Error(this.failure);
  }
}
