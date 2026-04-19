import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createServer } from "node:http";

export default definePluginEntry({
  id: "voice-satellite",
  name: "Voice Satellite",
  description: "Local voice assistant satellites via HA",
  register(api) {
    const config = (api.pluginConfig ?? {}) as any;
    const log = api.logger;

    // ── Guard 1: Check enabled FIRST, before anything else ────────
    if (config?.enabled === false) {
      log.info("[voice-satellite] Disabled via config");
      return;
    }

    // ── Guard 2: Only start server in full gateway mode ───────────
    // Do NOT start during install, inspect, or setup modes
    if (api.registrationMode !== "full") {
      log.info("[voice-satellite] Skipping (mode=" + api.registrationMode + ")");
      return;
    }

    const runtime = api.runtime;
    const port = config?.bridgePort ?? 8050;

    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", plugin: "voice-satellite" }));
        return;
      }
      if (url.pathname === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: "bob", object: "model" }] }));
        return;
      }
      if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const userMsg = body.messages?.filter((m: any) => m.role === "user")?.pop()?.content ?? "";
        const room = config?.satellites?.[(req.headers["x-satellite-id"] as string) ?? "default"]?.room ?? "default";

        log.info("[voice] " + room + ": " + userMsg.slice(0, 60));
        const sessionKey = "agent:main:telegram:direct:" + (config?.ownerChatId ?? "321403065");

        try {
          const { runId } = await runtime.subagent.run({ sessionKey, message: "[voice:" + room + "] " + userMsg });
          const result = await runtime.subagent.waitForRun({ runId, timeoutMs: 15000 });
          let text = "I processed your request.";
          if (result.status === "ok") {
            const { messages } = await runtime.subagent.getSessionMessages({ sessionKey, limit: 1 });
            const last = messages?.[0] as any;
            text = last?.content ?? last?.text ?? String(last ?? text);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            id: "c-" + Date.now().toString(36), object: "chat.completion",
            created: Math.floor(Date.now() / 1000), model: "bob",
            choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }));
        } catch (err) {
          log.warn("[voice] Error: " + err);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            id: "c-err", object: "chat.completion",
            created: Math.floor(Date.now() / 1000), model: "bob",
            choices: [{ index: 0, message: { role: "assistant", content: "I'm having trouble right now." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }));
        }
        return;
      }
      res.writeHead(404); res.end("Not Found");
    });

    // ── Guard 3: Fail once on port conflict, do NOT retry ─────────
    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        log.error("[voice-satellite] Port " + port + " already in use. NOT retrying. Fix the conflict and restart the gateway.");
      } else {
        log.error("[voice-satellite] Server error: " + err.message);
      }
      // Do NOT retry. Do NOT call server.listen again. Just log and stop.
    });

    server.listen(port, "0.0.0.0", () => {
      log.info("[voice-satellite] Bridge listening on 0.0.0.0:" + port);
    });
  },
});
