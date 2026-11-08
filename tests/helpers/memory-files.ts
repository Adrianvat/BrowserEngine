import type { FileSystem } from "../../tools/api";

/** An in-memory file system: a map of path -> text, or bytes for binary files. */
export class MemoryFiles implements FileSystem {
  readonly files = new Map<string, string | Uint8Array>();
  /** Every write and delete, in order, for checking what was touched. */
  readonly log: string[] = [];

  constructor(initial: Record<string, string | Uint8Array> = {}) {
    for (const [path, text] of Object.entries(initial)) this.files.set(path, text);
  }

  /** A text file's contents, for assertions. */
  text(path: string): string | undefined {
    const found = this.files.get(path);
    return typeof found === "string" ? found : undefined;
  }

  async list(folder: string): Promise<string[]> {
    const prefix = folder.replace(/\/?$/, "/");
    const names = new Set<string>();
    for (const path of this.files.keys()) {
      if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split("/")[0]);
    }
    return [...names].sort();
  }
  async read(path: string): Promise<string | null> {
    const found = this.files.get(path);
    return typeof found === "string" ? found : found ? new TextDecoder().decode(found) : null;
  }
  async write(path: string, text: string): Promise<void> {
    this.log.push(`write ${path}`);
    this.files.set(path, text);
  }
  async readBytes(path: string): Promise<Uint8Array | null> {
    const found = this.files.get(path);
    return typeof found === "string" ? new TextEncoder().encode(found) : (found ?? null);
  }
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.log.push(`write ${path}`);
    this.files.set(path, bytes);
  }
  async remove(path: string): Promise<void> {
    this.log.push(`remove ${path}`);
    this.files.delete(path);
  }
  async removeFolder(path: string): Promise<void> {
    this.log.push(`remove folder ${path}`);
    const prefix = path.replace(/\/?$/, "/");
    for (const key of [...this.files.keys()]) if (key.startsWith(prefix)) this.files.delete(key);
  }
}
