import axios from 'axios'
import { Config } from './config'

const BASE_URL = Config.FE_API_BASE
const SITE_URL = Config.FE_WEB_BASE

// Tuning values resolve at module load time. Config getters resolve env vars
// in dev and baked-in defaults in production — see src/config.ts.
const RECENCY_POOL = Config.RECENCY_POOL
const RECENCY_DAYS = Config.RECENCY_DAYS

// Allowlist of game IDs the worker should pull matches from. Empty array
// means "all games". Production ships a curated list — see src/config.ts.
const ALLOWED_GAME_IDS: Set<string> | null = Config.GAME_IDS.length > 0
  ? new Set(Config.GAME_IDS)
  : null

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface Player {
  id: string
  name: string
  slug: string
  profileUrl: string
}

export interface Game {
  id: string
  title: string
  abbreviation: string
}

export interface Video {
  _id: string
  Url: string
  VideoType: string
  ContentType?: string
  GameId?: string
  Game?: string
  Title?: string
  players?: Player[]
  clipStart?: number   // seconds; only present on tournament matches with timestamps
  clipEnd?: number     // seconds; only present on tournament matches with timestamps
}

// ── Raw API shapes ────────────────────────────────────────────────────────────

interface RawMatchPlayer {
  Slot: number
  Id: string
  CharacterIds: string[]
}

interface RawGame {
  _id: string
  Title: string
  Abbreviation: string
}

interface RawMatch {
  _id: string
  VideoUrl: string
  GameId: string
  Team1Players: RawMatchPlayer[]
  Team2Players: RawMatchPlayer[]
  Game: RawGame[]   // embedded via $lookup — comes back as array
  ClipStart?: string
  ClipEnd?: string
}

interface MatchesGameResponse {
  matches: RawMatch[]
}

interface GamesResponse {
  games: { _id: string; Title: string; Abbreviation: string }[]
}

interface OEmbedResponse {
  title: string
  author_name: string
}

interface PlayerResponse {
  _id: string
  Name: string
  Slug: string
}

// ── In-memory caches ──────────────────────────────────────────────────────────

const playerCache = new Map<string, Player>()
let gameCache: Game[] | null = null

// Tracks which skip offset to use next for each game so consecutive batches
// pull different videos from the recent pool.
const gameSkipOffset = new Map<string, number>()

// ── Game fetching ─────────────────────────────────────────────────────────────

export async function fetchGames(): Promise<Game[]> {
  if (gameCache) return gameCache
  const res = await axios.get<GamesResponse>(`${BASE_URL}/games`, { timeout: 8000 })
  gameCache = res.data.games.map((g) => ({
    id: g._id,
    title: g.Title,
    abbreviation: g.Abbreviation,
  }))
  return gameCache
}

// ── Per-game recent match pool ────────────────────────────────────────────────

async function fetchMatchesForGame(gameId: string, skip: number): Promise<RawMatch[]> {
  try {
    const res = await axios.get<MatchesGameResponse>(
      `${BASE_URL}/matchesGame/?queryValue=${gameId}&skip=${skip}`,
      { timeout: 8000 }
    )
    return res.data?.matches ?? []
  } catch {
    return []
  }
}

async function fetchRecentPoolForGame(gameId: string, poolSize: number): Promise<RawMatch[]> {
  const pages = Math.ceil(poolSize / 5)
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) => fetchMatchesForGame(gameId, i * 5))
  )
  return results.flat()
}

// Fetch matches for a specific player directly from the backend.
async function fetchMatchesForPlayer(playerId: string, skip: number): Promise<RawMatch[]> {
  try {
    const res = await axios.get<MatchesGameResponse>(
      `${BASE_URL}/matchesPlayer/?queryName=PlayerId&queryValue=${playerId}&skip=${skip}`,
      { timeout: 8000 }
    )
    return res.data?.matches ?? []
  } catch {
    return []
  }
}

async function fetchRecentPoolForPlayer(playerId: string, poolSize: number): Promise<RawMatch[]> {
  const pages = Math.ceil(poolSize / 5)
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) => fetchMatchesForPlayer(playerId, i * 5))
  )
  return results.flat()
}

// ── Tournament match fetching ─────────────────────────────────────────────────

// Fetch all tournament matches globally (no game filter) — used for the admin
// path. Filtering per-game is unreliable because GameIds may differ between
// the two collections.
async function fetchTournamentMatches(skip: number): Promise<RawMatch[]> {
  try {
    const res = await axios.get<MatchesGameResponse>(
      `${BASE_URL}/tournament-matches?skip=${skip}`,
      { timeout: 8000 }
    )
    const matches = res.data?.matches ?? []
    if (skip === 0) console.log(`[api] Tournament matches page 0: ${matches.length} results`)
    return matches
  } catch (err) {
    console.warn('[api] Failed to fetch tournament matches:', err instanceof Error ? err.message : err)
    return []
  }
}

async function fetchTournamentPool(poolSize: number): Promise<RawMatch[]> {
  const pages = Math.ceil(poolSize / 5)
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) => fetchTournamentMatches(i * 5))
  )
  const all = results.flat()
  console.log(`[api] Tournament pool total: ${all.length} matches`)
  return all
}

// Player-filtered tournament matches — query by PlayerId directly.
async function fetchTournamentMatchesForPlayer(playerId: string, skip: number): Promise<RawMatch[]> {
  try {
    const res = await axios.get<MatchesGameResponse>(
      `${BASE_URL}/tournament-matches?queryName=PlayerId&queryValue=${playerId}&skip=${skip}`,
      { timeout: 8000 }
    )
    return res.data?.matches ?? []
  } catch (err) {
    console.warn(`[api] Failed to fetch tournament matches for player ${playerId}:`, err instanceof Error ? err.message : err)
    return []
  }
}

async function fetchTournamentPoolForPlayer(playerId: string, poolSize: number): Promise<RawMatch[]> {
  const pages = Math.ceil(poolSize / 5)
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) => fetchTournamentMatchesForPlayer(playerId, i * 5))
  )
  return results.flat()
}

// Merge two match arrays, deduplicating by _id.
function mergeMatches(a: RawMatch[], b: RawMatch[]): RawMatch[] {
  const seen = new Set<string>()
  const out: RawMatch[] = []
  for (const m of [...a, ...b]) {
    const key = String(m._id)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(m)
    }
  }
  return out
}

// ── Supporting lookups ────────────────────────────────────────────────────────

async function fetchYouTubeTitle(videoId: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    const res = await axios.get<OEmbedResponse>(url, { timeout: 5000 })
    return res.data.title || null
  } catch {
    return null
  }
}

async function fetchPlayer(id: string): Promise<Player | null> {
  if (playerCache.has(id)) return playerCache.get(id)!

  // Try up to 3 times with increasing timeouts before giving up
  const timeouts = [8000, 12000, 15000]
  let lastError: unknown
  for (const timeout of timeouts) {
    try {
      const res = await axios.get<PlayerResponse>(`${BASE_URL}/players/${id}`, { timeout })
      const { Name, Slug } = res.data
      if (!Name) {
        console.warn(`[api] Player ${id} returned no Name field:`, res.data)
        break
      }

      const p: Player = {
        id,
        name: Name,
        slug: Slug || '',
        profileUrl: Slug ? `${SITE_URL}/p/${Slug}` : '',
      }
      playerCache.set(id, p)
      console.log(`[api] Fetched player: ${Name} (slug: ${Slug || 'none'})`)
      return p
    } catch (err) {
      lastError = err
      console.warn(`[api] Player ${id} fetch failed (timeout ${timeout}ms):`, err instanceof Error ? err.message : err)
    }
  }

  console.warn(`[api] Giving up on player ${id} after retries. Last error:`, lastError instanceof Error ? lastError.message : lastError)
  return null
}

function extractPlayerIds(match: RawMatch): string[] {
  const ids: string[] = []
  for (const p of match.Team1Players) ids.push(p.Id)
  for (const p of match.Team2Players) ids.push(p.Id)
  return ids
}

async function resolveMatch(match: RawMatch): Promise<Video> {
  const gameTitle = match.Game?.[0]?.Title

  const [title, ...playerResults] = await Promise.all([
    fetchYouTubeTitle(match.VideoUrl),
    ...extractPlayerIds(match).map(fetchPlayer),
  ])

  const players = (playerResults as (Player | null)[]).filter((p): p is Player => p !== null)

  const clipStart = parseTimestamp(match.ClipStart)
  const clipEnd   = parseTimestamp(match.ClipEnd)

  return {
    _id: match._id,
    Url: match.VideoUrl,
    VideoType: 'youtube',
    ContentType: 'Match',
    GameId: match.GameId,
    Game: gameTitle,
    Title: (title as string | null) ?? undefined,
    players: players.length ? players : undefined,
    ...(clipStart !== undefined && { clipStart }),
    ...(clipEnd   !== undefined && { clipEnd }),
  }
}

// ── Playlist builder ──────────────────────────────────────────────────────────

export interface MatchTypes {
  online: boolean
  tournament: boolean
}

export async function buildPlaylist(
  totalToFetch: number,
  playerIds?: string[],
  matchTypes: MatchTypes = { online: true, tournament: true },
): Promise<Video[]> {
  // ── Player-filtered path (premium / non-admin accounts) ──────────────────
  // Query the backend directly for each player's matches rather than sampling
  // a small game pool and filtering client-side. This is reliable regardless
  // of how active the player is.
  if (playerIds && playerIds.length > 0) {
    return buildPlaylistForPlayers(totalToFetch, playerIds, matchTypes)
  }

  // ── Admin path: all eligible recent matches ───────────────────────────────
  const games = await fetchGames()

  const targetGames = ALLOWED_GAME_IDS
    ? games.filter((g) => ALLOWED_GAME_IDS.has(g.id))
    : games

  if (targetGames.length === 0 && !matchTypes.tournament) return []

  // Fetch online matches per-game + one global tournament pool in parallel.
  // Tournament matches are NOT filtered per-game — the GameIds in the
  // tournament-matches collection may differ from those in the games list.
  const [gamePools, tournamentPool] = await Promise.all([
    Promise.all(
      targetGames.map(async (game) => {
        const skip = gameSkipOffset.get(game.id) ?? 0
        const matches = matchTypes.online
          ? await fetchRecentPoolForGame(game.id, RECENCY_POOL)
          : []
        gameSkipOffset.set(game.id, skip + RECENCY_POOL)

        // Recency filter applies only to online matches.
        const cutoff = RECENCY_DAYS > 0
          ? Date.now() - RECENCY_DAYS * 24 * 60 * 60 * 1000
          : 0
        const fresh = cutoff > 0
          ? matches.filter((m) => {
              const ts = parseInt(m._id.toString().substring(0, 8), 16) * 1000
              return ts >= cutoff
            })
          : matches

        return { game, matches: shuffle(fresh) }
      })
    ),
    matchTypes.tournament
      ? fetchTournamentPool(RECENCY_POOL * Math.max(targetGames.length, 1))
      : Promise.resolve([] as RawMatch[]),
  ])

  const activePools = gamePools.filter((p) => p.matches.length > 0)
  const shuffledTournament = shuffle(tournamentPool)

  if (activePools.length === 0 && shuffledTournament.length === 0) return []

  // Round-robin: interleave online game pools and tournament matches.
  // Every 3rd slot is a tournament match when both are available.
  const selected: RawMatch[] = []
  const seen = new Set<string>()
  let gameIdx = 0
  let tIdx = 0

  while (selected.length < totalToFetch) {
    const wantTournament =
      shuffledTournament.length > 0 &&
      (activePools.length === 0 || selected.length % 3 === 2)
    const wantOnline = activePools.length > 0 && !wantTournament

    if (wantTournament) {
      const m = shuffledTournament[tIdx % shuffledTournament.length]
      tIdx++
      if (!seen.has(String(m._id))) {
        seen.add(String(m._id))
        selected.push(m)
      } else if (tIdx >= shuffledTournament.length * 2) break
    } else if (wantOnline) {
      const pool = activePools[gameIdx % activePools.length]
      gameIdx++
      if (pool.matches.length === 0) continue
      const m = pool.matches[selected.length % pool.matches.length]
      if (!seen.has(String(m._id))) {
        seen.add(String(m._id))
        selected.push(m)
      }
    } else {
      break
    }
  }

  const videos: Video[] = []
  for (const match of selected) {
    videos.push(await resolveMatch(match))
  }
  return videos
}

// Fetch matches for one or more specific players by querying the backend
// player-matches endpoint directly. Merges and deduplicates across players.
async function buildPlaylistForPlayers(
  totalToFetch: number,
  playerIds: string[],
  matchTypes: MatchTypes,
): Promise<Video[]> {
  // Fetch regular + tournament matches per player in parallel, then merge
  const perPlayerMatches = await Promise.all(
    playerIds.map(async (id) => {
      const [regular, tournament] = await Promise.all([
        matchTypes.online     ? fetchRecentPoolForPlayer(id, RECENCY_POOL)     : Promise.resolve([]),
        matchTypes.tournament ? fetchTournamentPoolForPlayer(id, RECENCY_POOL) : Promise.resolve([]),
      ])
      return mergeMatches(regular, tournament)
    })
  )

  // Merge across players and deduplicate by match _id
  const seen = new Set<string>()
  const allMatches: RawMatch[] = []
  for (const matches of perPlayerMatches) {
    for (const m of matches) {
      const key = String(m._id)
      if (!seen.has(key)) {
        seen.add(key)
        allMatches.push(m)
      }
    }
  }

  if (allMatches.length === 0) return []

  // Shuffle and take up to totalToFetch
  const selected = shuffle(allMatches).slice(0, totalToFetch)

  const videos: Video[] = []
  for (const match of selected) {
    videos.push(await resolveMatch(match))
  }
  return videos
}

// Parse a timestamp string ("MM:SS", "H:MM:SS", or raw seconds as a string)
// into an integer number of seconds. Returns undefined if blank or unparseable.
function parseTimestamp(s: string | undefined): number | undefined {
  if (!s || !s.trim()) return undefined
  const parts = s.trim().split(':').map(Number)
  if (parts.some(isNaN)) return undefined
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return undefined
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
