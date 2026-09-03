import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const rootDir = process.cwd();
const distDir = path.resolve(rootDir, args.dist ?? "dist-real");
const newsDir = path.resolve(rootDir, args.news ?? "News");
const columnistsDir = path.resolve(rootDir, args.columnists ?? "Columnists");
const host = args.host ?? "0.0.0.0";
const port = Number.parseInt(args.port ?? "8123", 10);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const targetPath = resolveRequestPath(url.pathname);

    if (!targetPath) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found.");
      return;
    }

    const fileBuffer = await fs.readFile(targetPath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(targetPath).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(fileBuffer);
  } catch (error) {
    const statusCode = error?.code === "ENOENT" ? 404 : 500;
    response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(statusCode === 404 ? "Not found." : "Server error.");
  }
});

server.listen(port, host, async () => {
  const editionPath = path.join(distDir, "edition.html");
  await fs.access(editionPath);

  console.log("OOTP newspaper server is running.");
  console.log(`Local:   http://localhost:${port}/`);

  for (const address of getLanAddresses()) {
    console.log(`Network: http://${address}:${port}/`);
  }

  console.log(`Serving edition from ${editionPath}`);
});

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : "true";
    parsed[key] = value;

    if (value !== "true") {
      index += 1;
    }
  }

  return parsed;
}

function resolveRequestPath(pathname) {
  const decodedPath = decodeURIComponent(pathname || "/");

  if (decodedPath === "/" || decodedPath === "/edition.html") {
    return path.join(distDir, "edition.html");
  }

  if (decodedPath.startsWith("/news/")) {
    return resolveInsideRoot(newsDir, decodedPath.slice("/news/".length));
  }

  if (decodedPath.startsWith("/columnists/")) {
    return resolveInsideRoot(columnistsDir, decodedPath.slice("/columnists/".length));
  }

  return resolveInsideRoot(distDir, decodedPath.replace(/^\//, ""));
}

function resolveInsideRoot(root, relativePath) {
  const normalizedTarget = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);

  if (!normalizedTarget.startsWith(normalizedRoot)) {
    return "";
  }

  return normalizedTarget;
}

function getLanAddresses() {
  const addresses = [];

  for (const network of Object.values(os.networkInterfaces())) {
    for (const details of network ?? []) {
      if (!details || details.family !== "IPv4" || details.internal) {
        continue;
      }

      addresses.push(details.address);
    }
  }

  return addresses.sort();
}
