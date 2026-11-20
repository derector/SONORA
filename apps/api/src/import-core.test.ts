import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSourceUrl, normalizeForMatch, scoreMatch, parseGenericList, parseSpotifyExportJson,
  type MatchCandidate, type MatchWant
} from "./import-core.js";

describe("parseSourceUrl allowlist matrix", () => {
  it("parses every supported platform link", () => {
    const spotify = parseSourceUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
    assert.equal(spotify.kind, "spotify");
    assert.equal(spotify.externalId, "37i9dQZF1DXcBWIGoYBM5M");

    const spotifyIntl = parseSourceUrl("https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M");
    assert.equal(spotifyIntl.kind, "spotify");
    assert.equal(spotifyIntl.canonicalUrl, "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");

    const apple = parseSourceUrl("https://music.apple.com/us/playlist/chill-morning/pl.us.3944094514.943597684");
    assert.equal(apple.kind, "apple");
    assert.equal(apple.externalId, "pl.us.3944094514.943597684");

    const yandex = parseSourceUrl("https://music.yandex.ru/users/some.user/playlists/12345678");
    assert.equal(yandex.kind, "yandex");
    assert.equal(yandex.externalId, "12345678");

    const vk = parseSourceUrl("https://vk.com/playlist-123456789_2");
    assert.equal(vk.kind, "vk");
    assert.equal(vk.externalId, "123456789_2");

    const soundcloud = parseSourceUrl("https://soundcloud.com/flume/sets/into-death");
    assert.equal(soundcloud.kind, "soundcloud");
    assert.equal(soundcloud.externalId, "flume/into-death");

    const deezer = parseSourceUrl("https://www.deezer.com/fr/playlist/1178198131");
    assert.equal(deezer.kind, "deezer");
    assert.equal(deezer.externalId, "1178198131");
    assert.equal(deezer.canonicalUrl, "https://www.deezer.com/playlist/1178198131");

    const youtube = parseSourceUrl("https://music.youtube.com/playlist?list=RDMMVesklGnOMUw");
    assert.equal(youtube.kind, "youtube");
    assert.equal(youtube.externalId, "RDMMVesklGnOMUw");

    const jamendo = parseSourceUrl("https://www.jamendo.com/playlist/show/345173/sonora-favourites");
    assert.equal(jamendo.kind, "jamendo");
    assert.equal(jamendo.externalId, "345173");
  });

  it("rejects unparseable and off-allowlist links as unknown", () => {
    assert.equal(parseSourceUrl("not a url at all").kind, "unknown");
    assert.equal(parseSourceUrl("https://example.com/playlist/abc").kind, "unknown");
    assert.equal(parseSourceUrl("ftp://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M").kind, "unknown");
    assert.equal(parseSourceUrl("https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp").kind, "unknown");
    assert.equal(parseSourceUrl(undefined).kind, "unknown");
  });

  it("marks metadata-only platforms with needsManualExport and honest hints", () => {
    assert.equal(parseSourceUrl("https://music.yandex.ru/users/u/playlists/1").needsManualExport, true);
    assert.equal(parseSourceUrl("https://vk.com/playlist-1_1").needsManualExport, true);
    const youtube = parseSourceUrl("https://music.youtube.com/playlist?list=PLABCDEFGHIJ1234567890");
    assert.equal(youtube.needsManualExport, true);
    assert.match(youtube.hint ?? "", /Takeout/);
    // Fetchable platforms do not carry the manual-export flag from the parser.
    assert.notEqual(parseSourceUrl("https://www.deezer.com/playlist/123456789").needsManualExport, true);
    assert.notEqual(parseSourceUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M").needsManualExport, true);
  });
});

describe("normalizeForMatch", () => {
  it("folds case, diacritics and Russian ё/e", () => {
    assert.equal(normalizeForMatch("Beyoncé"), "beyonce");
    assert.equal(normalizeForMatch("Ёлка"), normalizeForMatch("Елка"));
    assert.equal(normalizeForMatch("Ёлка"), "елка");
  });

  it("strips feat./vs. segments, parentheses and version noise", () => {
    assert.equal(
      normalizeForMatch("Get Lucky (feat. Pharrell Williams & Nile Rodgers) [Radio Edit]"),
      "get lucky"
    );
    assert.equal(normalizeForMatch("Daft Punk feat. Pharrell Williams"), "daft punk");
    assert.equal(normalizeForMatch("Smells Like Teen Spirit - Official Video"), "smells like teen spirit");
    assert.equal(normalizeForMatch("Bohemian Rhapsody (Remastered 2011)"), "bohemian rhapsody");
  });
});

describe("scoreMatch", () => {
  const want: MatchWant = { artist: "Daft Punk", title: "Get Lucky", durationSeconds: 232 };
  const exact: MatchCandidate = { artist: "Daft Punk", title: "Get Lucky", durationSeconds: 232 };
  const featured: MatchCandidate = {
    artist: "Pharrell Williams, Daft Punk",
    title: "Get Lucky (feat. Pharrell Williams & Nile Rodgers)",
    durationSeconds: 250
  };
  const unrelated: MatchCandidate = { artist: "Daft Eyes", title: "Lucky Strike", durationSeconds: 90 };

  it("orders exact > featured variant > unrelated and stays in 0..1", () => {
    const sExact = scoreMatch(exact, want);
    const sFeatured = scoreMatch(featured, want);
    const sUnrelated = scoreMatch(unrelated, want);
    assert.ok(sExact > sFeatured, `expected ${sExact} > ${sFeatured}`);
    assert.ok(sFeatured > sUnrelated, `expected ${sFeatured} > ${sUnrelated}`);
    assert.ok(sUnrelated < 0.55, `unrelated should fall below threshold, got ${sUnrelated}`);
    for (const s of [sExact, sFeatured, sUnrelated]) assert.ok(s >= 0 && s <= 1);
  });

  it("rewards close durations and returns 0 for empty titles", () => {
    const withDuration = scoreMatch({ artist: "Daft Punk", title: "Get Lucky", durationSeconds: 240 }, want);
    const withoutDuration = scoreMatch({ artist: "Daft Punk", title: "Get Lucky", durationSeconds: 400 }, want);
    assert.ok(withDuration > withoutDuration);
    assert.equal(scoreMatch({ artist: "Anyone", title: "" }, want), 0);
  });
});

describe("parseSpotifyExportJson", () => {
  it("handles the privacy export {\"Playlists\":[...]} shape", () => {
    const text = JSON.stringify({
      Playlists: [{
        name: "My Mix",
        tracks: { Items: [
          { Artist: "Daft Punk", TrackName: "Get Lucky", AlbumName: "Random Access Memories", TrackUri: "spotify:track:abc" },
          { Artist: "Chvrches", TrackName: "The Mother We Share", AlbumName: "Lungs", TrackUri: "spotify:track:def" }
        ] }
      }]
    });
    const parsed = parseSpotifyExportJson(text);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.playlistName, "My Mix");
    assert.equal(parsed[0]?.items.length, 2);
    assert.deepEqual(parsed[0]?.items[0], { artist: "Daft Punk", title: "Get Lucky", album: "Random Access Memories" });
  });

  it("handles the newer {\"playlists\":[{\"tracks\":[{\"track\":...}]}]} shape", () => {
    const text = JSON.stringify({
      playlists: [{
        name: "Mix 2026",
        tracks: [
          { track: { name: "Song B", artists: [{ name: "Person A" }, { name: "Person B" }], album: { name: "Album C" } } },
          { track: { name: "Solo Song", artists: [{ name: "Person A" }], album: { name: "Album C" } } }
        ]
      }]
    });
    const parsed = parseSpotifyExportJson(text);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.items.length, 2);
    assert.equal(parsed[0]?.items[0]?.artist, "Person A, Person B");
    assert.equal(parsed[0]?.items[0]?.album, "Album C");
  });

  it("returns nothing for unrecognized JSON instead of guessing", () => {
    assert.deepEqual(parseSpotifyExportJson("{}"), []);
    assert.deepEqual(parseSpotifyExportJson("[]"), []);
    assert.deepEqual(parseSpotifyExportJson("{ not json"), []);
  });
});

describe("parseGenericList", () => {
  it("sniffs CSV headers case-insensitively and skips junk lines", () => {
    const text = [
      "ARTIST,Track,ALBUM",
      "Daft Punk,Get Lucky,Random Access Memories",
      "Beyoncé,  Halo  ,4",
      "",
      "# a comment",
      "1,2,3"
    ].join("\n");
    const parsed = parseGenericList(text);
    assert.equal(parsed.items.length, 2);
    assert.deepEqual(parsed.items[0], { artist: "Daft Punk", title: "Get Lucky", album: "Random Access Memories" });
    assert.equal(parsed.items[1]?.title, "Halo");
    assert.equal(parsed.items[1]?.artist, "Beyoncé");
  });

  it("handles TSV and the headerless Artist - Title fallback", () => {
    const tsv = parseGenericList("Title\tArtist\nSong A\tArtist X");
    assert.deepEqual(tsv.items, [{ artist: "Artist X", title: "Song A", album: null }]);
    const plain = parseGenericList("Bohemian Rhapsody\nDaft Punk - Get Lucky\nhttps://spam.example");
    assert.equal(plain.items.length, 2);
    assert.deepEqual(plain.items[1], { artist: "Daft Punk", title: "Get Lucky", album: null });
  });

  it("captures a playlist-name column when present", () => {
    const parsed = parseGenericList("Playlist Name,Artist,Title\nRoad trip,Vangelis,Alpha");
    assert.equal(parsed.playlistName, "Road trip");
    assert.equal(parsed.items[0]?.artist, "Vangelis");
  });
});
