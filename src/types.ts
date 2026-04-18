/**
 * Configuration types for the Voice Satellite plugin.
 */

export interface VoiceSatelliteConfig {
  enabled: boolean;
  bridgePort: number;
  ownerChatId: string;
  satellites: Record<string, SatelliteConfig>;
  tts: TtsConfig;
  responseRouting: ResponseRoutingConfig;
}

export interface SatelliteConfig {
  name: string;
  room: string;
  haEntityId?: string;
}

export interface TtsConfig {
  engine: "xtts" | "piper";
  xttsUrl: string;
  piperUrl: string;
  voiceRef: string;
}

export interface ResponseRoutingConfig {
  maxVoiceWords: number;
  alwaysEchoToTelegram: boolean;
  archiveLongResponses: boolean;
}

/**
 * OpenAI-compatible chat completion request (from HA).
 */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  user?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  name?: string;
}

/**
 * OpenAI-compatible chat completion response (to HA).
 */
export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Inbound voice message metadata.
 */
export interface VoiceMessage {
  satelliteId: string;
  room: string;
  transcript: string;
  timestamp: number;
}
