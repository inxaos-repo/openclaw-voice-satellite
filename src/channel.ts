/**
 * Voice Satellite Channel Implementation
 * 
 * Routes voice messages to the owner's main session by mapping
 * satellite IDs to the owner's Telegram chat ID. This gives
 * unified context: voice and Telegram share the same conversation.
 */

import type { VoiceSatelliteConfig, VoiceMessage } from "./types.js";

export class VoiceSatelliteChannel {
  private api: any;
  private config: VoiceSatelliteConfig;
  private pendingResponses: Map<string, {
    resolve: (text: string) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();

  constructor(api: any, config: VoiceSatelliteConfig) {
    this.api = api;
    this.config = config;
  }

  /**
   * Channel ID for OpenClaw registration.
   */
  get channelId(): string {
    return "voice-satellite";
  }

  /**
   * Session grammar: maps satellite IDs to the owner's chat session.
   * This is the key to unified context — all satellites route to
   * the same session as Telegram.
   */
  resolveSessionConversation(rawId: string) {
    return {
      // Route to owner's main chat (same as Telegram DM)
      baseConversationId: this.config.ownerChatId,
      // Thread by satellite for context
      threadId: undefined, // No threading — truly unified
    };
  }

  /**
   * Inject a voice transcript as an inbound message.
   * Returns a promise that resolves with Bob's response text.
   */
  async injectMessage(message: VoiceMessage): Promise<string> {
    const requestId = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const satelliteInfo = this.config.satellites?.[message.satelliteId];
    const roomTag = satelliteInfo?.room ?? message.satelliteId;
    
    // Tag the message with voice surface metadata
    const taggedContent = `[voice:${roomTag}] ${message.transcript}`;

    this.api.log.info(
      `[voice-satellite] Injecting from ${roomTag}: "${message.transcript.slice(0, 60)}"`
    );

    // Create a promise that will be resolved when the response comes back
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        reject(new Error(`Voice response timeout after 30s`));
      }, 30_000);

      this.pendingResponses.set(requestId, { resolve, reject, timer });

      // Dispatch the message through OpenClaw's channel system
      // The gateway will process it in the owner's session and
      // call our outbound handler with the response
      try {
        this.api.dispatchInboundMessage({
          channel: "voice-satellite",
          chatId: `voice:${message.satelliteId}`,
          senderId: this.config.ownerChatId,
          senderName: "Damon (voice)",
          text: taggedContent,
          metadata: {
            requestId,
            satelliteId: message.satelliteId,
            room: roomTag,
            surface: "voice",
          },
        });
      } catch (err) {
        clearTimeout(timer);
        this.pendingResponses.delete(requestId);
        reject(err as Error);
      }
    });
  }

  /**
   * Handle outbound messages (Bob's response going back to the satellite).
   */
  async sendMessage(chatId: string, text: string, metadata?: any): Promise<void> {
    const requestId = metadata?.requestId;
    
    if (requestId && this.pendingResponses.has(requestId)) {
      const pending = this.pendingResponses.get(requestId)!;
      clearTimeout(pending.timer);
      this.pendingResponses.delete(requestId);
      pending.resolve(text);
    }

    // Optionally route to Telegram based on response length
    if (this.config.responseRouting?.alwaysEchoToTelegram) {
      await this.echoToTelegram(text, metadata);
    } else if (
      this.config.responseRouting?.maxVoiceWords &&
      text.split(/\s+/).length > this.config.responseRouting.maxVoiceWords
    ) {
      // Long response: send summary to voice, full to Telegram
      const summary = this.summarizeForVoice(text);
      
      if (requestId && this.pendingResponses.has(requestId)) {
        // Override with summary for voice
        const pending = this.pendingResponses.get(requestId)!;
        pending.resolve(summary);
      }
      
      await this.echoToTelegram(text, metadata);
    }
  }

  /**
   * Summarize a long response for voice output.
   */
  private summarizeForVoice(text: string): string {
    const maxWords = this.config.responseRouting?.maxVoiceWords ?? 30;
    const words = text.split(/\s+/);
    if (words.length <= maxWords) return text;
    
    return words.slice(0, maxWords).join(" ") + "... I sent the details to Telegram.";
  }

  /**
   * Echo a response to Telegram for detailed viewing.
   */
  private async echoToTelegram(text: string, metadata?: any): Promise<void> {
    const room = metadata?.room ?? "unknown";
    try {
      // Use OpenClaw's message tool to send to Telegram
      this.api.log.debug(`[voice-satellite] Echoing to Telegram from ${room}`);
      // TODO: Use api.sendMessage or the message tool to deliver to Telegram
    } catch (err) {
      this.api.log.warn(`[voice-satellite] Failed to echo to Telegram: ${err}`);
    }
  }
}
