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
    // Use our proxy-image endpoint to allow images in COEP environment
    const tracks = res.data.results.map(item => {
      const rawImg = item.artworkUrl100?.replace('100x100', '600x600') || item.artworkUrl100;
      const proxyImg = rawImg ? `/proxy-image?url=${encodeURIComponent(rawImg)}` : null;

      return {
        id: "itunes-" + item.trackId,
        name: item.trackName,
        artists: [{ name: item.artistName }],
        album: {
          name: item.collectionName,
          images: [{ url: proxyImg }]
        },
        preview_url: item.previewUrl,
        external_urls: { spotify: item.trackViewUrl } // fallback link
      };
    });

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

// Proxy Image to bypass COEP/CORS issues
app.get("/proxy-image", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing url");
  try {
    const response = await axios.get(url, { responseType: 'stream' });
    res.setHeader('Content-Type', response.headers['content-type']);
    // Critical headers for COEP
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    response.data.pipe(res);
  } catch (e) {
    console.error("Image Proxy Error:", e.message);
    res.status(500).send("Failed to fetch image");
  }
});

app.get("/download", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing url" });

  try {
    console.log("Downloading via yt-dlp for:", url);
    const YTDlpWrap = require('yt-dlp-wrap').default;

    // Locate the binary downloaded by postinstall
    // In Vercel, it should be in the root or accessible via path
    // We assume it's in the root project folder found at ../yt-dlp relative to server/index.js
    const binaryPath = path.resolve(__dirname, '..', 'yt-dlp');
    console.log("Using yt-dlp binary at:", binaryPath);

    if (!fs.existsSync(binaryPath)) {
      throw new Error("yt-dlp binary not found on server.");
    }

    const ytDlpWrap = new YTDlpWrap(binaryPath);

    let downloadTarget = url;
    let title = 'audio';

    // IMPORTANT: Bypass Spotify DRM by searching YouTube for the track instead
    if (url.includes('spotify.com') || url.includes('spotify:')) {
      const match = url.match(/(?:track\/|spotify:track:)([a-zA-Z0-9]+)/);
      const id = match ? match[1] : null;
      if (id) {
        try {
          const token = await getSpotifyToken();
          const result = await axios.get(`https://api.spotify.com/v1/tracks/${id}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const trackData = result.data;
          title = `${trackData.artists.map(a => a.name).join(', ')} - ${trackData.name}`;
          // Use SoundCloud search to avoid YouTube blocking Vercel server IPs
          downloadTarget = `scsearch1:${title}`;
          console.log(`Parsed Spotify URL. Target: ${downloadTarget}`);
        } catch (e) {
          console.error("Spotify meta error:", e.message);
          throw new Error("Could not fetch Spotify metadata for this track. Check Spotify credentials.");
        }
      } else {
        throw new Error("Invalid Spotify URL provided.");
      }
    } else {
      // Fallback for non-spotify urls (e.g. Soundcloud)
      const metadata = await ytDlpWrap.getVideoInfo(url);
      title = metadata.title || 'audio';
    }

    const filename = `${title}.mp3`.replace(/[^a-z0-9 \.-]/gi, '_');

    console.log(`Starting yt-dlp stream for: ${title}`);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'audio/mpeg');

    // Stream download: -f bestaudio, pipe to stdout
    // Note: yt-dlp writes to stdout, which we pipe to res
    // Vercel only allows writing to /tmp, so we must force cache and temp fragments to /tmp
    const ytDlpStream = ytDlpWrap.execStream([
      downloadTarget,
      '-f', 'bestaudio',
      '--no-playlist',
      '--max-downloads', '1',
      '--cache-dir', '/tmp/yt-dlp-cache',
      '--paths', 'temp:/tmp',
      '-o', '-'
    ]);

    ytDlpStream.on('error', (err) => {
      console.error("yt-dlp error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Download process failed", detail: err.message });
    });

    ytDlpStream.pipe(res);

  } catch (e) {
    console.error("Download error:", e.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Download failed", detail: e.message });
    }
  }
});

// Global Error Handler to force JSON responses
app.use((err, req, res, next) => {
  console.error("Unhandled Server Error:", err);
  res.status(500).json({ error: "Internal Server Error", detail: err.message, stack: err.stack });
});

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

module.exports = app;
