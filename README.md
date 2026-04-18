# OpenClaw Voice Satellite

An [OpenClaw](https://openclaw.ai) channel plugin that connects local voice assistant satellites to the agent with unified context across voice, Telegram, Discord, and any other surface.

## How It Works

```
Voice PE → Wake Word → STT (faster-whisper) → Home Assistant
    → POST /v1/chat/completions → This Plugin → OpenClaw Session
    → Bob responds (same context as Telegram!) → Plugin returns response
    → HA → TTS (XTTS/Piper) → Voice PE speaker
```

The key: voice messages route to the **same session** as Telegram. Bob has one conversation, many surfaces.

## Install

```bash
openclaw plugins install ./openclaw-voice-satellite
openclaw gateway restart
```

## Configure

Add to your `openclaw.json`:

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
            "bedroom": { "name": "Bedroom Speaker", "room": "bedroom" }
          }
        }
      }
    }
  }
}
```

## Home Assistant Setup

1. **Settings → Integrations → Extended OpenAI Conversation**
2. **Base URL:** `http://<ginaz-ip>:8050/v1`
3. **API Key:** `sk-not-needed`
4. **Model:** `bob`
5. Assign to your voice pipeline

## Three-Tier Response Routing

| Response Length | Voice | Telegram |
|----------------|-------|----------|
| Short (≤30 words) | ✅ Speak it | Optional echo |
| Long (>30 words) | ✅ Summary | ✅ Full details |
| Data-heavy | ✅ "Check Telegram" | ✅ Link to Archives |

## Requirements

- OpenClaw Gateway running on ginaz
- Home Assistant with Wyoming voice pipeline
- Voice satellite (ESP32-S3, Voice PE, etc.)
- STT service (faster-whisper on Ix)
- TTS service (XTTS or Piper on Ix)

## License

MIT
