// Serves dist/ locally the way Cloudflare does: /asa/ -> dist/asa/index.html.
const root = `${import.meta.dir}/dist`;

Bun.serve({
  port: 8765,
  async fetch(req) {
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path.includes("..")) return new Response("Bad request", { status: 400 });
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file(root + path);
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  },
});
console.log("http://localhost:8765");
