import { collectProjects, type BundledProject } from "./collect";

/**
 * Every project in the projects folder, bundled with the pages: the game page plays
 * from this, and the editors show it when there is no dev server to read the files
 * from. The `?raw` globs bring in the text files; the `?url` glob brings in each image's
 * URL (hashed into the build, or inlined). Vite picks up every change to these files.
 *
 * Every page that imports this module (statically or not) must accept its hot updates
 * with `import.meta.hot.accept`; otherwise a saved file makes Vite reload every open
 * page, the editors and their unsaved work included. See the main.ts files.
 */
export const bundledProjects: Record<string, BundledProject> = collectProjects({
  settings: import.meta.glob("/projects/*/project.json", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
  scripts: import.meta.glob("/projects/*/scripts/{systems,components,scenes}/*.js", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
  orders: import.meta.glob("/projects/*/scripts/order.json", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
  scenes: import.meta.glob("/projects/*/scenes/*.json", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
  images: import.meta.glob("/projects/*/images/*.{png,jpg,jpeg,gif,webp,bmp,avif,svg}", {
    query: "?url",
    import: "default",
    eager: true,
  }) as Record<string, string>,
  sheets: import.meta.glob("/projects/*/images/*.json", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
});
