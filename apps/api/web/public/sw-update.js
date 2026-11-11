/* Loaded by the service worker. When a new version activates, every open window is told; a window running an old
   shell (which cannot answer) is reloaded directly, so nobody keeps looking at a stale version. */
const acks = new Set();
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("message", (e) => { if (e.data && e.data.type === "MZ_ACK" && e.source) acks.add(e.source.id); });
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (!wins.length) return;
    wins.forEach((c) => c.postMessage({ type: "MZ_NEW_VERSION" }));
    await new Promise((r) => setTimeout(r, 2500));
    for (const c of wins) if (!acks.has(c.id) && !/\/pos(\?|$)/.test(new URL(c.url).pathname)) { try { await c.navigate(c.url); } catch (e) { /* the window went away */ } }
  })());
});
