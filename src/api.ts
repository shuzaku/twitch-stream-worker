import axios from 'axios'

const BASE_URL = process.env.API_BASE_URL || 'https://fightme-server.herokuapp.com'
const SITE_URL = process.env.SITE_URL || 'https://www.fighters-edge.com'

export interface Player {
  id: string
  name: string
  slug: string
  profileUrl: string
}

export interface Video {
  _id: string
  Url: string            // YouTube video ID
  VideoType: string      // 'youtube'
  ContentType?: string
  GameId?: string
  Title?: string         // resolved from YouTube oEmbed
  Game?: string
  // Legacy string fields (unused — use players array instead)
  Player1?: string
  Player2?: string
  Character1?: string
  Character2?: string
  // Resolved player objects
  players?: Player[]
}

// Raw shape returned by the API for a video's Match embed
interface RawMatchPlayer {
  Slot: number
  Id: string
  CharacterIds: string[]
}

interface RawMatch {
  Team1Players: RawMatchPlayer[]
  Team2Players: RawMatchPlayer[]
}

interface RawVideo {
  _id: string
  Url: string
  VideoType: string
  ContentType?: string
  GameId?: string
  Match?: RawMatch
}

interface VideosResponse {
  videos: RawVideo[]
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

// Simple in-memory cache so we don't re-fetch the same player across batches
const playerCache = new Map<string, Player>()

export async function fetchVideoPage(skip: number): Promise<RawVideo[]> {
  const res = await axios.get<VideosResponse>(`${BASE_URL}/videos?skip=${skip}`)
  return res.data?.videos ?? (res.data as unknown as RawVideo[]) ?? []
}

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
  try {
    const res = await axios.get<PlayerResponse>(`${BASE_URL}/players/${id}`, { timeout: 5000 })
    const p: Player = {
      id,
      name: res.data.Name,
      slug: res.data.Slug,
      profileUrl: `${SITE_URL}/players/${res.data.Slug}`,
    }
    playerCache.set(id, p)
    return p
  } catch {
    return null
  }
}

function extractPlayerIds(raw: RawVideo): string[] {
  if (!raw.Match) return []
  const ids: string[] = []
  for (const p of raw.Match.Team1Players) ids.push(p.Id)
  for (const p of raw.Match.Team2Players) ids.push(p.Id)
  return ids
}

export async function buildPlaylist(totalToFetch: number): Promise<Video[]> {
  const rawList: RawVideo[] = []
  let skip = 0
  const pageSize = 20

  while (rawList.length < totalToFetch) {
    const page = await fetchVideoPage(skip)
    if (!page.length) break
    rawList.push(...page)
    skip += pageSize
  }

  const raws = shuffle(rawList.slice(0, totalToFetch))

  // Resolve titles and players in parallel (best-effort)
  const videos: Video[] = await Promise.all(
    raws.map(async (raw): Promise<Video> => {
      const [title, ...playerResults] = await Promise.all([
        fetchYouTubeTitle(raw.Url),
        ...extractPlayerIds(raw).map(fetchPlayer),
      ])

      const players = (playerResults as (Player | null)[]).filter((p): p is Player => p !== null)

      return {
        _id: raw._id,
        Url: raw.Url,
        VideoType: raw.VideoType,
        ContentType: raw.ContentType,
        GameId: raw.GameId,
        Title: (title as string | null) ?? undefined,
        players: players.length ? players : undefined,
      }
    })
  )

  return videos
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
