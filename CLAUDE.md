# CLAUDE.md — openclaw-voice-satellite

## What This Is
An OpenClaw channel plugin that connects local voice assistant satellites (ESP32-S3, Voice PE) to the agent via Home Assistant's Wyoming voice pipeline. Voice messages route to the same session as Telegram for unified context.

## Architecture
- **Channel plugin** using `defineChannelPluginEntry` from OpenClaw plugin SDK
- **Bridge server** exposes OpenAI-compatible `/v1/chat/completions` endpoint
- **Session routing** maps all voice satellites to the owner's Telegram chat session
- HA's Extended OpenAI Conversation integration POSTs transcripts here

## Key Files
- `src/index.ts` — Plugin entry point (register channel + start bridge)
- `src/channel.ts` — Channel implementation (session routing, message injection, response routing)
- `src/bridge-server.ts` — HTTP server receiving OpenAI-format requests from HA
- `src/types.ts` — TypeScript interfaces
- `openclaw.plugin.json` — Plugin manifest with config schema

## Session Routing (Critical Design)
All satellites route to the owner's base conversation ID (Telegram chat ID).
This means voice and Telegram share the SAME session context window.
```typescript
resolveSessionConversation(rawId) {
  return { baseConversationId: config.ownerChatId };
}
```

## Config
```json
{
  "plugins": {
    "entries": {
      "voice-satellite": {
        "enabled": true,
        "config": {
          "bridgePort": 8050,
          "ownerChatId": "321403065",
          "satellites": {
            "loft": { "name": "Loft Speaker", "room": "loft" },
            "bedroom": { "name": "Bedroom", "room": "bedroom" }
          }
        }
      }
    }
  }
}
```

## Response Routing (Three-Tier)
1. **Voice** — short summary (≤30 words) spoken aloud
2. **Telegram** — details + link sent as text
3. **Archives** — full data written to Wiki.js

## How HA Connects
1. HA Extended OpenAI Conversation: base_url = http://ginaz:8050/v1
2. Model: bob
3. Satellite triggers wake word → STT → HA → POST /v1/chat/completions → plugin
4. Plugin injects message into owner's session → Bob responds
5. Response returned to HA → TTS → satellite speaker

## Development
```bash
# Install deps (requires OpenClaw SDK)
pnpm install

# Install locally
openclaw plugins install ./

# Restart gateway
openclaw gateway restart

# Configure
# Add voice-satellite config to openclaw.json plugins.entries
```

## Pitfalls
- The plugin SDK types are from openclaw itself — need openclaw as a dev dependency or use type stubs
- `api.dispatchInboundMessage` is the key method — routes through the gateway's message queue
- Session contention: the gateway serializes messages to the same session, so voice waits for Telegram turns
- Bridge server must bind to 0.0.0.0 for HA to reach it from k8s
- The API objects (api.registerChannel, api.dispatchInboundMessage, etc.) need to be validated against actual SDK
