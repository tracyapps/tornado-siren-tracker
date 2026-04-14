const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const { getSirens, getStatus } = require("./lib/status-data");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function serveStaticFile(response, filePath) {
  try {
    const contents = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream"
    });
    response.end(contents);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    if (requestUrl.pathname === "/api/status") {
      const payload = await getStatus();
      json(response, 200, payload);
      return;
    }

    if (requestUrl.pathname === "/api/sources") {
      const sirens = await getSirens();
      json(response, 200, sirens.meta.sources);
      return;
    }

    if (requestUrl.pathname === "/") {
      await serveStaticFile(response, path.join(PUBLIC_DIR, "index.html"));
      return;
    }

    const requestedPath = path.normalize(requestUrl.pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(PUBLIC_DIR, requestedPath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    await serveStaticFile(response, filePath);
  } catch (error) {
    console.error(error);
    json(response, 500, {
      error: "Server error",
      detail: error.message
    });
  }
});

if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Tornado siren tracker running at http://127.0.0.1:${PORT}`);
  });
}

module.exports = {
  server
};
