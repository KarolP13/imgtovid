const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require('path');
const fs = require('fs');
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

let tokenCache = { token: null, expires: 0 };

async function getSpotifyToken() {
  if (tokenCache.token && Date.now() < tokenCache.expires) return tokenCache.token;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  console.log("Client ID:", clientId ? clientId.slice(0, 8) + "..." : "MISSING");
  console.log("Client Secret:", clientSecret ? "SET" : "MISSING");
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await axios.post("https://accounts.spotify.com/api/token",
    "grant_type=client_credentials",
    { headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" } }
  );
  tokenCache = { token: res.data.access_token, expires: Date.now() + (res.data.expires_in - 60) * 1000 };
  console.log("Spotify token obtained!");
  return tokenCache.token;
}


// -- iTunes Fallback Search --
async function searchItunes(query, limit = 20) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=${limit}`;
    const res = await axios.get(url);

    // Map iTunes results to Spotify-like format for frontend compatibility
    const tracks = res.data.results.map(item => ({
      id: "itunes-" + item.trackId,
      name: item.trackName,
      artists: [{ name: item.artistName }],
      album: {
        name: item.collectionName,
        images: [{ url: item.artworkUrl100?.replace('100x100', '600x600') || item.artworkUrl100 }]
      },
      preview_url: item.previewUrl,
      external_urls: { spotify: item.trackViewUrl } // fallback link
    }));

    return { tracks: { items: tracks } };
  } catch (e) {
    console.error("iTunes search failed:", e.message);
    throw new Error("All search providers failed.");
  }
}

app.get("/search", async (req, res) => {
  const { q, type = "track" } = req.query;
  const limit = 20;

  // Try Spotify first
  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    try {
      const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=${type}&market=US&limit=${limit}`;
      console.log(`Spotify Search: "${q}"`);
      const token = await getSpotifyToken();
      const result = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      return res.json(result.data);
    } catch (e) {
      console.error("Spotify Search Error (falling back):", e.response?.data || e.message);
    }
  } else {
    console.log("Spotify credentials missing. Using iTunes fallback.");
  }

  // Fallback to iTunes
  try {
    console.log(`iTunes Fallback Search: "${q}"`);
    const data = await searchItunes(q, limit);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Search failed", detail: "Could not search Spotify or iTunes." });
  }
});

app.get("/proxy-audio", async (req, res) => {
  try {
    const { artist, track } = req.query;
    console.log(`Proxy Audio: Searching iTunes for "${artist} - ${track}"`);

    // Search iTunes
    const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(artist + " " + track)}&media=music&limit=5`;
    const searchRes = await axios.get(searchUrl);

    const results = searchRes.data.results;
    // Simple improvement: try to find exact match or just take first
    const match = results.find(r => r.previewUrl) || results[0];

    if (!match || !match.previewUrl) {
      console.log("Proxy Audio: No match found.");
      return res.status(404).json({ error: "Audio not found" });
    }

    console.log(`Proxy Audio: Found match "${match.trackName}". Streaming: ${match.previewUrl}`);

    // Stream the audio back
    const audioRes = await axios.get(match.previewUrl, { responseType: 'stream' });
    res.setHeader('Content-Type', 'audio/mp4'); // usually m4a/aac
    audioRes.data.pipe(res);

  } catch (e) {
    console.error("Proxy Audio Error:", e.message);
    res.status(500).json({ error: "Failed to fetch audio" });
  }
});

app.get("/download", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing url" });

  try {
    console.log("Proxying download via Spotisaver:", url);

    // 1. Extract ID
    const match = url.match(/(?:track\/|spotify:track:)([a-zA-Z0-9]+)/);
    const id = match ? match[1] : null;
    if (!id) return res.status(400).json({ error: "Invalid Spotify URL" });

    // 2. Get Metadata from Spotisaver
    const metaUrl = `https://spotisaver.net/api/get_playlist.php?id=${id}&type=track&lang=en`;
    console.log(`Fetching metadata from: ${metaUrl}`);

    // Pass a real-looking user agent to avoid blocking
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://spotisaver.net/'
    };

    const metaRes = await axios.get(metaUrl, { headers });

    // Handle HTML error responses from Spotisaver
    if (typeof metaRes.data === 'string' && metaRes.data.trim().startsWith('<')) {
      console.error("Spotisaver returned HTML instead of JSON metadata.");
      throw new Error("Upstream provider returned an error page.");
    }

    if (!metaRes.data || !metaRes.data.tracks || metaRes.data.tracks.length === 0) {
      console.error("Spotisaver Metadata Error:", JSON.stringify(metaRes.data));
      throw new Error("Track not found on Spotisaver");
    }

    const trackData = metaRes.data.tracks[0];
    const userIp = '192.168.1.1'; // Mock IP to avoid 127.0.0.1 blocking issues

    console.log(`Found track: ${trackData.name}. Requesting download...`);

    // 3. Request Download
    const downloadRes = await axios.post('https://spotisaver.net/api/download_track.php', {
      track: trackData,
      download_dir: "downloads",
      filename_tag: "SPOTISAVER",
      user_ip: userIp,
      is_premium: false
    }, {
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Origin': 'https://spotisaver.net'
      },
      responseType: 'stream'
    });

    // 4. Pipe Response
    const filename = `${trackData.artists.join(', ')} - ${trackData.name}.mp3`.replace(/[^a-z0-9 \.-]/gi, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'audio/mpeg');

    downloadRes.data.pipe(res);

  } catch (e) {
    console.error("Download proxy error:", e.message);
    // Return JSON error even if upstream failed, to avoid "Unexpected token <" in client
    if (!res.headersSent) {
      res.status(500).json({ error: "Download failed", detail: e.message || "Could not fetch from Spotisaver." });
    }
  }
});

app.get("/track/:id", async (req, res) => {
  try {
    const token = await getSpotifyToken();
    const result = await axios.get(`https://api.spotify.com/v1/tracks/${req.params.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(result.data);
  } catch (e) {
    res.status(500).json({ error: "Track lookup failed" });
  }
});

// Export for Vercel
module.exports = app;

// Only listen if run directly
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
      console.warn("⚠️  WARNING: SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET is missing via .env. Search will fail.");
    }
  });
}
