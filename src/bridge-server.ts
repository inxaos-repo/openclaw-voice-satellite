/**
 * Bridge Server — OpenAI-compatible HTTP endpoint
 * 
 * Receives voice transcripts from Home Assistant's Extended OpenAI
 * Conversation integration. Returns responses in OpenAI chat
 * completion format.
 * 
 * HA sends: POST /v1/chat/completions { messages: [...] }
 * We return: { choices: [{ message: { content: "..." } }] }
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { VoiceSatelliteConfig, ChatCompletionRequest, ChatCompletionResponse } from "./types.js";
import type { VoiceSatelliteChannel } from "./channel.js";

export function createBridgeServer(
  api: any,
  config: VoiceSatelliteConfig,
  channel: VoiceSatelliteChannel,
) {
  const port = config.bridgePort ?? 8050;
  let server: ReturnType<typeof createServer> | null = null;

  function start() {
    server = createServer(async (req, res) => {
      try {
        await handleRequest(req, res);
      } catch (err) {
        api.log.error(`[voice-bridge] Unhandled error: ${err}`);
        sendJson(res, 500, { error: { message: "Internal server error" } });
      }
    });

    server.listen(port, "0.0.0.0", () => {
      api.log.info(`[voice-bridge] Listening on 0.0.0.0:${port}`);
    });
  }

  function stop() {
    if (server) {
      server.close();
      server = null;
    }
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    
    // CORS headers for HA
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      return sendJson(res, 200, {
        status: "ok",
        plugin: "voice-satellite",
        satellites: Object.keys(config.satellites ?? {}),
      });
    }

    // Model list (OpenAI compat)
    if (url.pathname === "/v1/models" && req.method === "GET") {
      return sendJson(res, 200, {
        object: "list",
        data: [
          { id: "bob", object: "model", created: Date.now(), owned_by: "openclaw" },
        ],
      });
    }

    // Chat completions (main endpoint)
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      const body = await readBody(req);
      let request: ChatCompletionRequest;
      
      try {
        request = JSON.parse(body);
      } catch {
        return sendJson(res, 400, { error: { message: "Invalid JSON" } });
      }

      // Extract user message
      const userMessage = request.messages
        ?.filter(m => m.role === "user")
        ?.pop()
        ?.content;

      if (!userMessage) {
        return sendJson(res, 400, { error: { message: "No user message" } });
      }

      // Detect satellite from request metadata or default
      const satelliteId = detectSatellite(req, request);

      api.log.info(
        `[voice-bridge] Request from ${satelliteId}: "${userMessage.slice(0, 60)}"`
      );

      const startMs = Date.now();

      try {
        // Inject through the channel → same session as Telegram
        const responseText = await channel.injectMessage({
          satelliteId,
          room: config.satellites?.[satelliteId]?.room ?? satelliteId,
          transcript: userMessage,
          timestamp: Date.now(),
        });

        const elapsedMs = Date.now() - startMs;
        api.log.info(
          `[voice-bridge] Response (${elapsedMs}ms): "${responseText.slice(0, 60)}"`
        );

        return sendJson(res, 200, makeCompletionResponse(responseText, request.model));
      } catch (err) {
        const elapsedMs = Date.now() - startMs;
        api.log.warn(
          `[voice-bridge] Failed after ${elapsedMs}ms: ${err}`
        );

        // Fallback response
        return sendJson(res, 200, makeCompletionResponse(
          "I'm having trouble thinking right now. Try again in a moment.",
          request.model,
        ));
      }
    }

    // 404 for everything else
    sendJson(res, 404, { error: { message: "Not found" } });
  }

  /**
   * Detect which satellite sent the request.
   * HA doesn't natively identify the satellite in the API call,
   * so we check headers and fall back to "default".
   */
  function detectSatellite(req: IncomingMessage, request: ChatCompletionRequest): string {
    // Check custom header
    const headerSatellite = req.headers["x-satellite-id"] as string;
    if (headerSatellite) return headerSatellite;

    // Check user field in request
    if (request.user) return request.user;

    // Default
    return "default";
  }

  return { start, stop };
}

// ── Helpers ──────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function makeCompletionResponse(text: string, model = "bob"): ChatCompletionResponse {
  return {
    id: `chatcmpl-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: "stop",
    }],
    usage: {
      prompt_tokens: 0,
      completion_tokens: text.split(/\s+/).length,
      total_tokens: text.split(/\s+/).length,
    },
  };
}
