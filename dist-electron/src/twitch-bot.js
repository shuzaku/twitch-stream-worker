"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwitchBot = void 0;
const tmi_js_1 = __importDefault(require("tmi.js"));
const CHANNEL = process.env.TWITCH_CHANNEL || '';
const USERNAME = process.env.TWITCH_BOT_USERNAME || '';
const TOKEN = process.env.TWITCH_BOT_TOKEN || ''; // OAuth token: oauth:xxxxxxxx
class TwitchBot {
    constructor() {
        this.client = null;
        this.connected = false;
    }
    async connect() {
        if (!CHANNEL || !USERNAME || !TOKEN) {
            console.warn('[bot] TWITCH_CHANNEL, TWITCH_BOT_USERNAME or TWITCH_BOT_TOKEN not set — chat bot disabled');
            return;
        }
        this.client = new tmi_js_1.default.Client({
            options: { debug: false },
            identity: { username: USERNAME, password: TOKEN },
            channels: [CHANNEL],
        });
        try {
            await this.client.connect();
            this.connected = true;
            console.log(`[bot] Connected to #${CHANNEL}`);
        }
        catch (err) {
            console.error('[bot] Failed to connect:', err);
        }
        this.client.on('disconnected', (reason) => {
            this.connected = false;
            console.warn(`[bot] Disconnected: ${reason}`);
        });
    }
    async announceVideo(video) {
        if (!this.connected || !this.client)
            return;
        const parts = [];
        // Video title
        const title = video.Title || `Match ${video.Url}`;
        parts.push(`Now playing: ${title}`);
        // YouTube link
        parts.push(`▶ https://youtu.be/${video.Url}`);
        // Player profile links — only include players that have a profile URL
        if (video.players && video.players.length > 0) {
            const playerLinks = video.players
                .map((p) => p.profileUrl ? `${p.name} → ${p.profileUrl}` : p.name)
                .join('  |  ');
            parts.push(playerLinks);
        }
        const message = parts.join('  •  ');
        try {
            await this.client.say(CHANNEL, message);
        }
        catch (err) {
            console.error('[bot] Failed to send message:', err);
        }
    }
    disconnect() {
        if (this.client && this.connected) {
            this.client.disconnect();
            this.connected = false;
        }
    }
}
exports.TwitchBot = TwitchBot;
