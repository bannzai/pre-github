import { Hono } from "hono";

const app = new Hono<{ Bindings: Cloudflare.Env }>();

app.get("/healthz", (c) => c.json({ ok: true }));

export default app;
