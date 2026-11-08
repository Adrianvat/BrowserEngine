// The Node side of the file APIs: a Vite dev-server plugin. Kept apart from the API
// modules (which are pure and unit-tested) because the project has no Node type
// definitions; tsconfig.json leaves this file out.
import { promises as fs } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import type { FileSystem } from "./api.ts";
import { changeOf, handleProjectsRequest, ProjectFiles } from "./project-files.ts";

/** Where the API is mounted; the pages' clients (src/dev-api) use the same path. */
const MOUNT = "/api/projects";

/**
 * The event sent over Vite's websocket when a file in a project changes on disk,
 * whoever changed it. Its data is a FilesChange (src/dev-api/changes.ts).
 */
export const FILES_CHANGED_EVENT = "browser-engine:files-changed";

function isMissing(error: unknown): boolean {
  return (error as { code?: string }).code === "ENOENT";
}

/** Node's file system, as the APIs need it. */
const nodeFiles: FileSystem = {
  async list(folder) {
    try {
      return await fs.readdir(folder);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  },
  async read(path) {
    try {
      return await fs.readFile(path, "utf8");
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  },
  async write(path, text) {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, text, "utf8");
  },
  async readBytes(path) {
    try {
      return new Uint8Array(await fs.readFile(path));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  },
  async writeBytes(path, bytes) {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, bytes);
  },
  async remove(path) {
    try {
      await fs.unlink(path);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  },
  async removeFolder(path) {
    await fs.rm(path, { recursive: true, force: true });
  },
};

/**
 * Serves the projects folder to the editors at /api/projects (see handleProjectsRequest
 * for the routes) and tells open pages when a file in a project changes, whoever
 * changed it. Development only: a production build has no server, and bundles the
 * projects instead.
 */
export function gameFilesPlugin(projectsFolder: string): Plugin {
  let root = "";
  return {
    name: "browser-engine:game-files",
    hotUpdate({ file, modules }) {
      // A project file deleted and made again (a project removed and re-created, say)
      // keeps a stale module node with no importers, which Vite takes for a dead end and
      // answers with a full page reload. Without that node the update goes through the
      // bundle's glob, which accepts it, as for any other change.
      if (!file.startsWith(root + sep)) return;
      return modules.filter((mod) => mod.importers.size > 0);
    },
    configureServer(server) {
      root = resolve(server.config.root, projectsFolder);
      const files = new ProjectFiles(root, nodeFiles);

      server.middlewares.use(MOUNT, (req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
          const body = Buffer.concat(chunks).toString("utf8");
          void handleProjectsRequest(files, { method: req.method ?? "GET", path, body }).then((response) => {
            res.statusCode = response.status;
            res.setHeader("Cache-Control", "no-store");
            if (response.file) {
              res.setHeader("Content-Type", response.file.type);
              res.end(Buffer.from(response.file.bytes));
            } else {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(response.body));
            }
          });
        });
      });

      server.watcher.on("all", (event: string, file: string) => {
        const inside = relative(root, file);
        if (inside.startsWith("..") || inside.includes(`..${sep}`) || inside === "") return;
        const data = changeOf(inside.split(sep).join("/"), event);
        if (data) server.ws.send({ type: "custom", event: FILES_CHANGED_EVENT, data });
      });
    },
  };
}
