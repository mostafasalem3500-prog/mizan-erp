// Copies the built API server (dist), the web app (web/dist) and the SQL migrations into ./server
// so the desktop app can run the exact same server locally against an embedded PostgreSQL.
const fs = require("fs");
const path = require("path");
const api = path.resolve(__dirname, "../../api");
const out = path.resolve(__dirname, "../server");
const need = [["dist", "dist"], ["web/dist", "web/dist"], ["db/migrations", "db/migrations"]];
for (const [from] of need) if (!fs.existsSync(path.join(api, from))) { console.error(`missing ${from} — run "npm run build" in apps/api first`); process.exit(1); }
fs.rmSync(out, { recursive: true, force: true });
for (const [from, to] of need) fs.cpSync(path.join(api, from), path.join(out, to), { recursive: true });
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ name: "mizan-server", private: true, main: "dist/server.js" }, null, 2));
console.log("server prepared in", out);
