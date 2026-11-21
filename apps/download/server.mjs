import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";

const root = resolve(process.cwd(), "dist");
const port = Number(process.env.PORT || 8080);
const mime = {
  ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",
  ".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",
  ".ico":"image/x-icon",".xml":"application/xml; charset=utf-8",
  ".txt":"text/plain; charset=utf-8",".woff2":"font/woff2"
};

createServer(async (req,res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Allow":"GET, HEAD" }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    const requested = resolve(root, "." + pathname);
    if (requested !== root && !requested.startsWith(root + sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    let file = requested;
    try {
      const info = await stat(file);
      if (info.isDirectory()) file = resolve(file, "index.html");
    } catch {
      file = resolve(root, "index.html");
    }
    const data = await readFile(file);
    const isHtml = extname(file) === ".html";
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "Cache-Control": isHtml ? "no-cache" : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    if (req.method === "HEAD") res.end();
    else res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type":"text/plain; charset=utf-8" }).end("Not found");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`SONORA Download Site listening on 0.0.0.0:${port}`);
});
