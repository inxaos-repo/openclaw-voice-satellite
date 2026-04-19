/**
 * OpenClaw Voice Satellite Plugin
 * 
 * Channel plugin that connects local voice assistant satellites
 * to OpenClaw via Home Assistant's Wyoming voice pipeline.
 * 
 * Voice transcripts arrive as HTTP POSTs (OpenAI-compatible format)
 * on a route registered directly on the gateway. Messages are
 * dispatched as inbound DMs to the owner's session for unified
 * context across voice, Telegram, Discord, and any other surface.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { VoiceSatelliteConfig, ChatCompletionRequest } from "./types.js";

export default definePluginEntry({
  id: "voice-satellite",
  name: "Voice Satellite",
  description: "Local voice assistant satellites via Home Assistant Wyoming protocol",

  register(api) {
    const config = (api.pluginConfig ?? {}) as VoiceSatelliteConfig;

    if (config.enabled === false) {
      api.logger.info("[voice-satellite] Plugin disabled");
      return;
    }

    const log = api.logger;
    const runtime = api.runtime;

    // Track pending voice requests awaiting agent responses
    const pendingRequests = new Map<string, {
      resolve: (text: string) => void;
      timer: ReturnType<typeof setTimeout>;
    }>();

    // ── Register HTTP route on the gateway ────────────────────────
    // HA's Extended OpenAI Conversation POSTs here.
    // Path: /voice/v1/chat/completions
    
    api.registerHttpRoute({
      path: "/voice/v1/chat/completions",
      auth: "plugin",  // Plugin handles its own auth (or none for local)
      match: "exact",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          });
          res.end();
          return true;
        }

        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return true;
        }

        try {
          const body = await readBody(req);
          const request: ChatCompletionRequest = JSON.parse(body);

          // Extract user message
          const userMessage = request.messages
            ?.filter((m) => m.role === "user")
            ?.pop()?.content;

          if (!userMessage) {
            sendJson(res, 400, { error: "No user message" });
            return true;
          }

          // Detect satellite
          const satelliteId =
            (req.headers["x-satellite-id"] as string) ??
            request.user ??
            "default";
          const satelliteConfig = config.satellites?.[satelliteId];
          const room = satelliteConfig?.room ?? satelliteId;

          log.info(`[voice] Request from ${room}: "${userMessage.slice(0, 60)}"`);

          const startMs = Date.now();

          // ── Dispatch through the agent via subagent.run ──────────
          // This creates a run in the owner's session, waits for
          // completion, and returns the response.
          const ownerChatId = config.ownerChatId ?? "321403065";
          const sessionKey = runtime.channel.routing.buildAgentSessionKey({
            channel: "telegram",
            chatType: "direct",
            chatId: ownerChatId,
          });

          // Tag the message with voice surface metadata
          const taggedMessage = `[voice:${room}] ${userMessage}`;

          try {
            // Use subagent.run to dispatch into the session
            const { runId } = await runtime.subagent.run({
              sessionKey,
              message: taggedMessage,
            });

            // Wait for the response
            const result = await runtime.subagent.waitForRun({
              runId,
              timeoutMs: (config.timeoutSeconds ?? 15) * 1000,
            });

            const elapsedMs = Date.now() - startMs;

            if (result.status === "ok") {
              // Get the last assistant message from the session
              const { messages } = await runtime.subagent.getSessionMessages({
                sessionKey,
                limit: 1,
              });

              const lastMessage = messages?.[0];
              const responseText =
                typeof lastMessage === "string"
                  ? lastMessage
                  : (lastMessage as any)?.content ??
                    (lastMessage as any)?.text ??
                    "I processed your request.";

              log.info(
                `[voice] Response (${elapsedMs}ms): "${String(responseText).slice(0, 60)}"`
              );

              sendJson(res, 200, makeCompletionResponse(String(responseText)));
            } else {
              log.warn(`[voice] Run failed (${elapsedMs}ms): ${result.error}`);
              sendJson(res, 200, makeCompletionResponse(
                "I'm having trouble thinking right now. Try again in a moment."
              ));
            }
          } catch (err) {
            const elapsedMs = Date.now() - startMs;
            log.warn(`[voice] Error (${elapsedMs}ms): ${err}`);
            sendJson(res, 200, makeCompletionResponse(
              "I'm having trouble right now. Try again in a moment."
            ));
          }

          return true;
        } catch (err) {
          log.error(`[voice] Request parse error: ${err}`);
          sendJson(res, 400, { error: "Invalid request" });
          return true;
        }
      },
    });

    // ── Models endpoint (OpenAI compat) ───────────────────────────
    api.registerHttpRoute({
      path: "/voice/v1/models",
      auth: "plugin",
      match: "exact",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        sendJson(res, 200, {
          object: "list",
          data: [{ id: "bob", object: "model", created: Date.now(), owned_by: "openclaw" }],
        });
        return true;
      },
    });

    // ── Health endpoint ───────────────────────────────────────────
    api.registerHttpRoute({
      path: "/voice/health",
      auth: "plugin",
      match: "exact",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        sendJson(res, 200, {
          status: "ok",
          plugin: "voice-satellite",
          satellites: Object.keys(config.satellites ?? {}),
          ownerChatId: config.ownerChatId,
        });
        return true;
      },
    });

    log.info(
      `[voice-satellite] Registered HTTP routes on gateway ` +
      `(${Object.keys(config.satellites ?? {}).length} satellite(s))`
    );
  },
});

// ── Helpers ────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function makeCompletionResponse(text: string) {
  return {
    id: `chatcmpl-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "bob",
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
