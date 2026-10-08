/** Public, cacheable product images: /api/media/products/:id?v=<version>. Ids are random UUIDs; the version busts caches on change. */
import { Router } from "express";
import { db } from "../db/pool";

export const media = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

media.get("/products/:id", async (req, res) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(404).end();
    const r = await db.maybe(`SELECT image, floor(extract(epoch FROM image_updated_at))::bigint v FROM products WHERE id=$1`, [req.params.id]);
    const m = r?.image && /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(r.image);
    if (!m) return res.status(404).end();
    const etag = `"p-${req.params.id.slice(0, 8)}-${r.v || 0}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", req.query.v ? "public, max-age=31536000, immutable" : "public, max-age=300");
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    res.type(m[1] === "image/jpg" ? "image/jpeg" : m[1]).send(Buffer.from(m[2], "base64"));
  } catch { res.status(500).end(); }
});
