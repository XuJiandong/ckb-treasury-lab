import { join, normalize } from "node:path";

const root = join(import.meta.dir, "dist");

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4173),
  async fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname));
    const file = Bun.file(join(root, path === "/" ? "index.html" : path));
    if (!file.name?.startsWith(root) || !(await file.exists())) {
      return new Response("Not found. Run `bun run build` first.", { status: 404 });
    }
    return new Response(file);
  },
});

console.log(`Preview of dist/: ${server.url}`);
