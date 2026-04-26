"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchGames = fetchGames;
exports.buildPlaylist = buildPlaylist;
const axios_1 = __importDefault(require("axios"));
const BASE_URL = process.env.API_BASE_URL || 'https://fightme-server.herokuapp.com';
const SITE_URL = process.env.SITE_URL || 'https://www.fighters-edge.com';
// How many recent matches per game to fetch into the pool each batch.
// The matchesGame endpoint returns 5 per page; RECENCY_POOL is rounded up to
// the nearest multiple of 5 when fetching.
const RECENCY_POOL = parseInt(process.env.RECENCY_POOL || '20', 10);
// Optional allowlist of game IDs (comma-separated). Empty = all games.
const ALLOWED_GAME_IDS = process.env.GAME_IDS
    ? new Set(process.env.GAME_IDS.split(',').map((s) => s.trim()).filter(Boolean))
    : null;
// ── In-memory caches ──────────────────────────────────────────────────────────
const playerCache = new Map();
let gameCache = null;
// Tracks which skip offset to use next for each game so consecutive batches
// pull different videos from the recent pool.
const gameSkipOffset = new Map();
// ── Game fetching ─────────────────────────────────────────────────────────────
async function fetchGames() {
    if (gameCache)
        return gameCache;
    const res = await axios_1.default.get(`${BASE_URL}/games`, { timeout: 8000 });
    gameCache = res.data.games.map((g) => ({
        id: g._id,
        title: g.Title,
        abbreviation: g.Abbreviation,
    }));
    return gameCache;
}
// ── Per-game recent match pool ────────────────────────────────────────────────
async function fetchMatchesForGame(gameId, skip) {
    try {
        const res = await axios_1.default.get(`${BASE_URL}/matchesGame/?queryValue=${gameId}&skip=${skip}`, { timeout: 8000 });
        return res.data?.matches ?? [];
    }
    catch {
        return [];
    }
}
async function fetchRecentPoolForGame(gameId, poolSize) {
    const pages = Math.ceil(poolSize / 5);
    const results = await Promise.all(Array.from({ length: pages }, (_, i) => fetchMatchesForGame(gameId, i * 5)));
    return results.flat();
}
// ── Supporting lookups ────────────────────────────────────────────────────────
async function fetchYouTubeTitle(videoId) {
    try {
        const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const res = await axios_1.default.get(url, { timeout: 5000 });
        return res.data.title || null;
    }
    catch {
        return null;
    }
}
async function fetchPlayer(id) {
    if (playerCache.has(id))
        return playerCache.get(id);
    // Try up to 3 times with increasing timeouts before giving up
    const timeouts = [8000, 12000, 15000];
    let lastError;
    for (const timeout of timeouts) {
        try {
            const res = await axios_1.default.get(`${BASE_URL}/players/${id}`, { timeout });
            const { Name, Slug } = res.data;
            if (!Name) {
                console.warn(`[api] Player ${id} returned no Name field:`, res.data);
                break;
            }
            const p = {
                id,
                name: Name,
                slug: Slug || '',
                profileUrl: Slug ? `${SITE_URL}/p/${Slug}` : '',
            };
            playerCache.set(id, p);
            console.log(`[api] Fetched player: ${Name} (slug: ${Slug || 'none'})`);
            return p;
        }
        catch (err) {
            lastError = err;
            console.warn(`[api] Player ${id} fetch failed (timeout ${timeout}ms):`, err instanceof Error ? err.message : err);
        }
    }
    console.warn(`[api] Giving up on player ${id} after retries. Last error:`, lastError instanceof Error ? lastError.message : lastError);
    return null;
}
function extractPlayerIds(match) {
    const ids = [];
    for (const p of match.Team1Players)
        ids.push(p.Id);
    for (const p of match.Team2Players)
        ids.push(p.Id);
    return ids;
}
async function resolveMatch(match) {
    const gameTitle = match.Game?.[0]?.Title;
    const [title, ...playerResults] = await Promise.all([
        fetchYouTubeTitle(match.VideoUrl),
        ...extractPlayerIds(match).map(fetchPlayer),
    ]);
    const players = playerResults.filter((p) => p !== null);
    return {
        _id: match._id,
        Url: match.VideoUrl,
        VideoType: 'youtube',
        ContentType: 'Match',
        GameId: match.GameId,
        Game: gameTitle,
        Title: title ?? undefined,
        players: players.length ? players : undefined,
    };
}
// ── Playlist builder ──────────────────────────────────────────────────────────
async function buildPlaylist(totalToFetch, playerId) {
    const games = await fetchGames();
    // Filter to allowlisted games only
    const targetGames = ALLOWED_GAME_IDS
        ? games.filter((g) => ALLOWED_GAME_IDS.has(g.id))
        : games;
    if (targetGames.length === 0)
        return [];
    // Fetch recent match pools for all target games in parallel
    const pools = await Promise.all(targetGames.map(async (game) => {
        const skip = gameSkipOffset.get(game.id) ?? 0;
        const matches = await fetchRecentPoolForGame(game.id, RECENCY_POOL);
        // Advance the offset for next batch so we don't repeat the same videos
        gameSkipOffset.set(game.id, skip + RECENCY_POOL);
        return { game, matches: shuffle(matches) };
    }));
    // If a specific player is authenticated, filter pools to only their matches
    const filteredPools = playerId
        ? pools.map((p) => ({
            ...p,
            matches: p.matches.filter((m) => [...m.Team1Players, ...m.Team2Players].some((mp) => mp.Id === playerId)),
        }))
        : pools;
    const activePools = filteredPools.filter((p) => p.matches.length > 0);
    if (activePools.length === 0)
        return [];
    // Round-robin across games to build a mixed playlist
    const selected = [];
    let gameIdx = 0;
    while (selected.length < totalToFetch) {
        const pool = activePools[gameIdx % activePools.length];
        gameIdx++;
        if (pool.matches.length === 0)
            continue;
        const match = pool.matches[selected.length % pool.matches.length];
        selected.push(match);
    }
    // Resolve matches sequentially to avoid hammering the players API with
    // too many simultaneous requests (which caused second-player lookups to fail)
    const videos = [];
    for (const match of selected) {
        videos.push(await resolveMatch(match));
    }
    return videos;
}
function shuffle(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
