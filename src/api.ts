import axios from 'axios'

const BASE_URL = process.env.API_BASE_URL || 'https://fightme-server.herokuapp.com'
const SITE_URL = process.env.SITE_URL || 'https://www.fighters-edge.com'

// How many recent matches per game to fetch into the pool each batch.
// The matchesGame endpoint returns 5 per page; RECENCY_POOL is rounded up to
// the nearest multiple of 5 when fetching.
const RECENCY_POOL = parseInt(process.env.RECENCY_POOL || '20', 10)

// Optional allowlist of game IDs (comma-separated). Empty = all games.
const ALLOWED_GAME_IDS: Set<string> | null = process.env.GAME_IDS
  ? new Set(process.env.GAME_IDS.split(',').map((s) => s.trim()).filter(Boolean))
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

  return {
    _id: match._id,
    Url: match.VideoUrl,
    VideoType: 'youtube',
    ContentType: 'Match',
    GameId: match.GameId,
    Game: gameTitle,
    Title: (title as string | null) ?? undefined,
    players: players.length ? players : undefined,
  }
}

// ── Playlist builder ──────────────────────────────────────────────────────────

export async function buildPlaylist(totalToFetch: number): Promise<Video[]> {
  const games = await fetchGames()

  // Filter to allowlisted games only
  const targetGames = ALLOWED_GAME_IDS
    ? games.filter((g) => ALLOWED_GAME_IDS.has(g.id))
    : games

  if (targetGames.length === 0) return []

  // Fetch recent match pools for all target games in parallel
  const pools = await Promise.all(
    targetGames.map(async (game) => {
      const skip = gameSkipOffset.get(game.id) ?? 0
      const matches = await fetchRecentPoolForGame(game.id, RECENCY_POOL)

      // Advance the offset for next batch so we don't repeat the same videos
      gameSkipOffset.set(game.id, skip + RECENCY_POOL)

      return { game, matches: shuffle(matches) }
    })
  )

  const activePools = pools.filter((p) => p.matches.length > 0)

  if (activePools.length === 0) return []

  // Round-robin across games to build a mixed playlist
  const selected: RawMatch[] = []
  let gameIdx = 0

  while (selected.length < totalToFetch) {
    const pool = activePools[gameIdx % activePools.length]
    gameIdx++

    if (pool.matches.length === 0) continue

    const match = pool.matches[selected.length % pool.matches.length]
    selected.push(match)
  }

  // Resolve matches sequentially to avoid hammering the players API with
  // too many simultaneous requests (which caused second-player lookups to fail)
  const videos: Video[] = []
  for (const match of selected) {
    videos.push(await resolveMatch(match))
  }

  return videos
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
