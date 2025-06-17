/**
 * Anonymous Twitch chat reader via tmi.js WebSocket.
 * No authentication needed — uses justinfan anonymous connection.
 */
import tmi from 'tmi.js';

export interface ChatMessage {
  username: string;
  text: string;
  timestamp: number;
  channel: string;
  emotes: string[];
  isAction: boolean;
}

type MessageCallback = (msg: ChatMessage) => void;

export class ChatReader {
  private client: tmi.Client | null = null;
  private channel: string;
  private callbacks: MessageCallback[] = [];

  constructor(channel: string) {
    this.channel = channel.toLowerCase().replace('#', '');
  }

  onMessage(callback: MessageCallback): void {
    this.callbacks.push(callback);
  }

  async connect(): Promise<void> {
    this.client = new tmi.Client({
      options: { debug: false },
      connection: {
        secure: true,
        reconnect: true,
      },
      channels: [this.channel],
    });

    this.client.on('message', (_channel, tags, message, self) => {
      if (self) return;

      const emotes: string[] = [];
      if (tags.emotes) {
        for (const emoteId of Object.keys(tags.emotes)) {
          emotes.push(emoteId);
        }
      }

      const msg: ChatMessage = {
        username: tags['display-name'] || tags.username || 'anonymous',
        text: message,
        timestamp: Date.now(),
        channel: this.channel,
        emotes,
        isAction: tags['message-type'] === 'action',
      };

      for (const cb of this.callbacks) {
        cb(msg);
      }
    });

    await this.client.connect();
  }

  disconnect(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.callbacks = [];
  }
}
