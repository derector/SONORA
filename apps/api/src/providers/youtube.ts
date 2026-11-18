type YouTubeSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } };
  };
};

type YouTubeSearchResponse = { items?: YouTubeSearchItem[] };

export type YouTubeDiscoveryItem = {
  id: string;
  provider: "YouTube";
  title: string;
  artist: string;
  album: null;
  durationSeconds: null;
  artworkUrl: string | null;
  sourceUrl: string;
  playable: false;
  metadataOnly: true;
};

export async function searchYouTubeVideos(query: string, limit = 10): Promise<YouTubeDiscoveryItem[]> {
  const apiKey = process.env.YOUTUBE_DATA_API_KEY;
  if (!apiKey) throw new Error("YouTube Data API key is not configured.");

  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    type: "video",
    part: "snippet",
    maxResults: String(Math.min(25, Math.max(1, limit))),
    safeSearch: "none"
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error(`YouTube search failed (HTTP ${response.status}).`);

  const payload = await response.json() as YouTubeSearchResponse;
  return (payload.items ?? []).flatMap((item) => {
    const videoId = item.id?.videoId;
    const title = item.snippet?.title;
    if (!videoId || !title) return [];
    return [{
      id: `youtube:${videoId}`,
      provider: "YouTube" as const,
      title,
      artist: item.snippet?.channelTitle ?? "YouTube channel",
      album: null,
      durationSeconds: null,
      artworkUrl: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      playable: false as const,
      metadataOnly: true as const
    }];
  });
}
