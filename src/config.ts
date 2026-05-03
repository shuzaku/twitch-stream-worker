// ─────────────────────────────────────────────────────────────────────────────
//  Build-time configuration for FightersEdge AutoStream
// ─────────────────────────────────────────────────────────────────────────────
//
//  This file is the SINGLE source of truth for every value the shipped
//  desktop app needs to operate against the FightersEdge backend. All values
//  are baked into the production build — end users do NOT need a .env file.
//
//  Local-dev overrides:
//    For convenience while developing, every value below CAN be overridden
//    via a process.env.<NAME> environment variable, but ONLY when the app is
//    running unpackaged (i.e. via `npm run dev` or `npm run electron:dev`).
//    In a packaged production build, env vars are ignored — the user's
//    machine could have stray env vars set that we don't want sneaking in.
//
//  Notes on what's safe to bake in:
//    - TWITCH_CLIENT_ID is NOT a secret in the OAuth implicit flow. Twitch
//      explicitly supports embedding it in native/desktop clients; the
//      registered redirect URI is what protects against impersonation.
//    - There are no client secrets, DB credentials, or service-account keys
//      in this file. Those live on the FightersEdge backend.

// `process` is the Node global, available in both the Electron main process
// and any Node-context code. The renderer never imports this file.
declare const process: { env: Record<string, string | undefined> } | undefined

// True only when running unpackaged (npm run dev / electron:dev). We set this
// from the entry point — see how it's wired up in electron/main.ts and
// src/index.ts. Defaults to false (production) so any consumer that forgets
// to call setDevMode() gets the safe behaviour.
let _devMode = false
export function setDevMode(isDev: boolean) {
    _devMode = isDev
}

function envOverride(name: string): string | undefined {
    if (!_devMode) return undefined
    if (typeof process === 'undefined') return undefined
    return process.env[name]
}

// ─────────────────────────────────────────────────────────────────────────────
//  Production constants — edit these for a release build
// ─────────────────────────────────────────────────────────────────────────────

// FightersEdge web app — used as the consent/redirect target for the device
// auth flow.
const PROD_FE_WEB_BASE = 'https://www.fighters-edge.com'

// FightersEdge API backend.
const PROD_FE_API_BASE = 'https://fightmeserver.fly.dev'

// Twitch OAuth Client ID for the chat-bot connection feature.
// REGISTER YOUR APP at https://dev.twitch.tv/console/apps with these redirect
// URIs (one for the bot connect flow, one for any future Twitch flows):
//     http://localhost:7778/twitch-bot-callback
//
// Then paste the Client ID here. It is NOT a secret.
const PROD_TWITCH_CLIENT_ID = 'wjlbl7oi8samr7l11e0507fpdkgnkk'  // ← TODO: paste your Twitch Client ID here before shipping

// Default playlist tuning. End users have no way to set these so they must
// have sensible production values baked in.
const PROD_GAME_IDS: string[] = [
    '68cba126f261500022897969',
    '67c358569ce15c00218b5873',
    '634645f85d8bf70023c99296',
    '6066bf970508cf858c0f538f',
    '606d42021ddff92064798667',
    '67344ae075ab4c002162ac71',
]
const PROD_RECENCY_POOL = 20    // Per-game pool size to randomly sample from
const PROD_RECENCY_DAYS = 30    // Drop matches older than this (0 = disabled)
const PROD_QUEUE_SIZE   = 10    // How many videos to pre-fetch into the queue

// Internal — local HTTP servers. No reason these would ever need to vary.
const PROD_PLAYER_PORT             = 3001
const PROD_DEVICE_CALLBACK_PORT    = 7777
const PROD_TWITCH_BOT_CALLBACK_PORT = 7778

// ─────────────────────────────────────────────────────────────────────────────
//  Public, read-time configuration accessors
// ─────────────────────────────────────────────────────────────────────────────

export const Config = {
    get FE_WEB_BASE(): string {
        return envOverride('FE_WEB_BASE') ?? PROD_FE_WEB_BASE
    },
    get FE_API_BASE(): string {
        return envOverride('API_BASE_URL') ?? PROD_FE_API_BASE
    },
    get TWITCH_CLIENT_ID(): string {
        return envOverride('TWITCH_CLIENT_ID') ?? PROD_TWITCH_CLIENT_ID
    },

    get GAME_IDS(): string[] {
        const raw = envOverride('GAME_IDS')
        if (raw) return raw.split(',').map((s) => s.trim()).filter(Boolean)
        return PROD_GAME_IDS
    },
    get RECENCY_POOL(): number {
        return parseInt(envOverride('RECENCY_POOL') ?? String(PROD_RECENCY_POOL), 10)
    },
    get RECENCY_DAYS(): number {
        return parseInt(envOverride('RECENCY_DAYS') ?? String(PROD_RECENCY_DAYS), 10)
    },
    get QUEUE_SIZE(): number {
        return parseInt(envOverride('QUEUE_SIZE') ?? String(PROD_QUEUE_SIZE), 10)
    },

    get PLAYER_PORT(): number {
        return parseInt(envOverride('PLAYER_PORT') ?? String(PROD_PLAYER_PORT), 10)
    },
    get DEVICE_CALLBACK_PORT(): number {
        return PROD_DEVICE_CALLBACK_PORT
    },
    get TWITCH_BOT_CALLBACK_PORT(): number {
        return PROD_TWITCH_BOT_CALLBACK_PORT
    },
}
