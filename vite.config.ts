import { resolve } from "node:path";
import { defineConfig } from "vite";
import { gameFilesPlugin } from "./tools/game-files-plugin.ts";

export default defineConfig({
  // The editors read and write the projects (their scripts, scenes and images) through the dev server.
  plugins: [gameFilesPlugin("projects")],
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        editor: resolve(import.meta.dirname, "editor.html"),
        perf: resolve(import.meta.dirname, "perf.html"),
        livePerf: resolve(import.meta.dirname, "live-perf.html"),
        spriteEditor: resolve(import.meta.dirname, "sprite-editor.html"),
        codeEditor: resolve(import.meta.dirname, "code-editor.html"),
      },
    },
  },
});
