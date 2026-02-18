// launcher.js (CommonJS) — starts a localhost server and opens GlyphScope in your browser.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

function openBrowser(targetUrl) {
  // Windows: open default browser
  execFile("cmd", ["/c", "start", "", targetUrl], { windowsHide: true });
}

function rootDir() {
  // In a SEA exe, this points to the exe. We want the folder containing the exe.
  // When running as plain node launcher.js, process.execPath points to node.exe,
  // which likely won't have index.html next to it, so fall back to this script folder.
  const exeDir = path.dirname(process.execPath);
  const scriptDir = __dirname;

  // Prefer "folder containing the exe" IF it has index.html (shipping layout)
  if (fs.existsSync(path.join(exeDir, "index.html"))) return exeDir;
  return scriptDir;
}

const ROOT = rootDir();
const HOST = "127.0.0.1";
const PORT = 8765;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function safeResolve(p) {
  // Prevent directory traversal
  const resolved = path.normalize(path.join(ROOT, p));
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
}

// ---- Debug + crash reporting (so the window doesn't vanish with no clue) ----
function logLine(msg) {
  try {
    const fp = path.join(ROOT, "glyphscope-launcher.log");
    fs.appendFileSync(fp, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

process.on("uncaughtException", (err) => {
  logLine("uncaughtException: " + (err && err.stack ? err.stack : String(err)));
  console.error(err);
  // Keep process alive briefly so you can see it if running from terminal
  setTimeout(() => process.exit(1), 2000);
});

process.on("unhandledRejection", (err) => {
  logLine("unhandledRejection: " + (err && err.stack ? err.stack : String(err)));
  console.error(err);
  setTimeout(() => process.exit(1), 2000);
});

logLine("Launcher starting...");
logLine("execPath: " + process.execPath);
logLine("cwd: " + process.cwd());
logLine("ROOT: " + ROOT);

// ---- Server ----
const server = http.createServer((req, res) => {
const pathname = new URL(req.url || "/", `http://${HOST}:${PORT}`).pathname;
let pathOnly = pathname;


if (pathOnly === "/") pathOnly = "/index.html";
const filePath = safeResolve(pathOnly);

  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.on("error", (e) => {
  logLine("server error: " + (e && e.stack ? e.stack : String(e)));
  console.error("Server error:", e);
  // If port is in use, you'll see it here.
  setTimeout(() => process.exit(1), 2000);
});

server.listen(PORT, HOST, () => {
  const target = `http://${HOST}:${PORT}/`;
  logLine(`Server started: ${target}`);
  openBrowser(target);
  logLine("Browser open requested.");
});
