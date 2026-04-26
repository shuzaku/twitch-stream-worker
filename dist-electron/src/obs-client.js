"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OBSClient = void 0;
const obs_websocket_js_1 = __importStar(require("obs-websocket-js"));
class OBSClient {
    constructor(url, password) {
        this.obs = new obs_websocket_js_1.default();
        this.connected = false;
        this.url = url ?? process.env.OBS_WS_URL ?? 'ws://localhost:4455';
        this.password = password ?? process.env.OBS_WS_PASSWORD ?? '';
    }
    async connect() {
        try {
            await this.obs.connect(this.url, this.password || undefined);
            this.connected = true;
            console.log('[obs] Connected to OBS WebSocket');
            this.obs.on('ConnectionClosed', () => {
                this.connected = false;
                console.warn('[obs] Connection closed — will retry on next action');
            });
        }
        catch (err) {
            this.connected = false;
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[obs] Could not connect to OBS (${msg}) — streaming control disabled`);
        }
    }
    async startStream() {
        if (!this.connected) {
            console.warn('[obs] Not connected — skipping StartStream');
            return;
        }
        try {
            const status = await this.obs.call('GetStreamStatus');
            if (status.outputActive) {
                console.log('[obs] Stream already active');
                return;
            }
            await this.obs.call('StartStream');
            console.log('[obs] Stream started');
        }
        catch (err) {
            const msg = err instanceof obs_websocket_js_1.OBSWebSocketError ? err.message : String(err);
            console.error(`[obs] StartStream failed: ${msg}`);
        }
    }
    async stopStream() {
        if (!this.connected)
            return;
        try {
            const status = await this.obs.call('GetStreamStatus');
            if (!status.outputActive)
                return;
            await this.obs.call('StopStream');
            console.log('[obs] Stream stopped');
        }
        catch (err) {
            const msg = err instanceof obs_websocket_js_1.OBSWebSocketError ? err.message : String(err);
            console.error(`[obs] StopStream failed: ${msg}`);
        }
    }
    disconnect() {
        if (this.connected) {
            this.obs.disconnect();
            this.connected = false;
        }
    }
}
exports.OBSClient = OBSClient;
