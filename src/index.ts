/**
 * OpenClaw Voice Satellite Plugin
 * 
 * Channel plugin that connects local voice assistant satellites
 * (ESP32-S3, Voice PE, etc.) to OpenClaw via Home Assistant's
 * Wyoming voice pipeline.
 * 
 * Voice transcripts arrive as HTTP POSTs (OpenAI-compatible format)
 * and are routed to the owner's main session for unified context
 * across voice, Telegram, Discord, and any other surface.
 * 
 * Responses are returned synchronously to HA for TTS playback,
 * and optionally echoed to Telegram with additional details.
 */

import { defineChannelPluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createBridgeServer } from "./bridge-server.js";
import { VoiceSatelliteChannel } from "./channel.js";
import type { VoiceSatelliteConfig } from "./types.js";

export default defineChannelPluginEntry({
  id: "voice-satellite",
  name: "Voice Satellite",
  description: "Local voice assistant satellites via Home Assistant",

  register(api) {
    const config = api.getConfig<VoiceSatelliteConfig>();
    
    if (!config?.enabled) {
      api.log.info("[voice-satellite] Plugin disabled");
      return;
    }

    const channel = new VoiceSatelliteChannel(api, config);
    
    // Register the channel with OpenClaw
    api.registerChannel(channel);

    // Start the HTTP bridge server (receives transcripts from HA)
    const bridge = createBridgeServer(api, config, channel);
    bridge.start();

    api.log.info(
      `[voice-satellite] Started on port ${config.bridgePort ?? 8050} ` +
      `with ${Object.keys(config.satellites ?? {}).length} satellite(s)`
    );

    // Cleanup on shutdown
    api.onShutdown(() => {
      bridge.stop();
      api.log.info("[voice-satellite] Stopped");
    });
  },
});
