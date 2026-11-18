type SoundCloudTrack = {
  id?: number;
  urn?: string;
  title?: string;
  duration?: number;
  artwork_url?: string | null;
  permalink_url?: string;
  user?: { username?: string; permalink_url?: string };
  publisher_metadata?: { artist?: string; album_title?: string } | null;
};

type SoundCloudSearchResponse = {
  collection?: SoundCloudTrack[];
};

type SoundCloudMetadata = {
  id: string;
  provider: "SoundCloud";
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number | null;
  artworkUrl: string | null;
  sourceUrl: string;
  playable: false;
  metadataOnly: true;
};

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getSoundCloudToken(): Promise<string> {
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("SoundCloud API credentials are not configured.");

  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const response = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error(`SoundCloud token request failed (HTTP ${response.status}).`);

  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("SoundCloud returned no access token.");
  cachedToken = payload.access_token;
  tokenExpiresAt = Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000;
  return cachedToken;
}

export async function searchSoundCloudTracks(query: string, limit = 12): Promise<SoundCloudMetadata[]> {
  const token = await getSoundCloudToken();
  const params = new URLSearchParams({
    q: query,
    access: "playable",
    limit: String(Math.min(50, Math.max(1, limit))),
    linked_partitioning: "true"
  });
  const response = await fetch(`https://api.soundcloud.com/tracks?${params.toString()}`, {
    headers: { Accept: "application/json; charset=utf-8", Authorization: `OAuth ${token}` },
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) {
    if (response.status === 401) {
      cachedToken = null;
      tokenExpiresAt = 0;
    }
    throw new Error(`SoundCloud search failed (HTTP ${response.status}).`);
  }

  const payload = await response.json() as SoundCloudSearchResponse;
  return (payload.collection ?? []).flatMap((track) => {
    if (!track.id || !track.title || !track.permalink_url) return [];
    return [{
      id: `soundcloud:${track.id}`,
      provider: "SoundCloud" as const,
      title: track.title,
      artist: track.publisher_metadata?.artist ?? track.user?.username ?? "SoundCloud creator",
      album: track.publisher_metadata?.album_title ?? null,
      durationSeconds: typeof track.duration === "number" ? Math.round(track.duration / 1000) : null,
      artworkUrl: track.artwork_url ?? null,
      sourceUrl: track.permalink_url,
      playable: false as const,
      metadataOnly: true as const
    }];
  });
}
