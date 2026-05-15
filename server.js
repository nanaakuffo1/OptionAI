const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URLSearchParams } = require("url");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || "optionai-demo";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const COOKIE_NAME = "optionai_session";

const sessions = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function timingSafeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, decodeURIComponent(rest.join("=") || "")];
    }).filter(([key]) => key)
  );
}

function isAuthed(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!raw) return false;
  const [id, sig] = raw.split(".");
  return Boolean(id && sig && sessions.has(id) && timingSafeEqual(sig, sign(id)));
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(303, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function loginPage(error = "") {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OptionAI Access</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body class="login-screen">
  <main class="login-panel">
    <div class="mark">OptionAI</div>
    <h1>Protected Trading Workspace</h1>
    <p>Enter the shared access password to view the dashboard.</p>
    <form method="post" action="/login">
      <input name="password" type="password" autocomplete="current-password" placeholder="Access password" autofocus />
      <button type="submit">Enter Workspace</button>
    </form>
    ${error ? `<div class="login-error">${error}</div>` : ""}
  </main>
</body>
</html>`;
}

function serveFile(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "Not found");
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600",
      "X-Frame-Options": "SAMEORIGIN",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    return send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json" });
  }

  if (url.pathname === "/login" && req.method === "GET") {
    if (isAuthed(req)) return redirect(res, "/");
    return send(res, 200, loginPage(), { "Content-Type": "text/html; charset=utf-8" });
  }

  if (url.pathname === "/login" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8192) req.destroy();
    });
    req.on("end", () => {
      const password = new URLSearchParams(body).get("password") || "";
      if (!timingSafeEqual(password, ACCESS_PASSWORD)) {
        return send(res, 401, loginPage("That password did not match."), { "Content-Type": "text/html; charset=utf-8" });
      }
      const id = crypto.randomBytes(24).toString("hex");
      sessions.set(id, { createdAt: Date.now() });
      res.writeHead(303, {
        Location: "/",
        "Set-Cookie": `${COOKIE_NAME}=${id}.${sign(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
        "Cache-Control": "no-store"
      });
      res.end();
    });
    return;
  }

  if (url.pathname === "/logout") {
    const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (raw) sessions.delete(raw.split(".")[0]);
    res.writeHead(303, {
      Location: "/login",
      "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      "Cache-Control": "no-store"
    });
    return res.end();
  }

  if (!isAuthed(req)) return redirect(res, "/login");
  return serveFile(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`OptionAI running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`Access password: ${ACCESS_PASSWORD}`);
});
