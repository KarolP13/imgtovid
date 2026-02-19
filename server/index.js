const express = require("express");
const cors = require("cors");
const axios = require("axios");
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

app.get("/search", async (req, res) => {
  try {
    const { q, type = "track" } = req.query;
    const limit = 10; // Safer limit to avoid API errors
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=${type}&market=US&limit=${limit}`;
    console.log(`Searching for "${q}" (limit: ${limit}) URL: ${url}`);
    const token = await getSpotifyToken();
    const result = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(result.data);
  } catch (e) {
    console.error("Search error:", e.response?.data || e.message);
    const detail = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: "Search failed", detail });
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

    console.log(`Proxy Audio: Found match "${match.trackName}" by ${match.artistName}. Streaming: ${match.previewUrl}`);

    // Stream the audio back
    const audioRes = await axios.get(match.previewUrl, { responseType: 'stream' });
    res.setHeader('Content-Type', 'audio/mp4'); // usually m4a/aac
    audioRes.data.pipe(res);

  } catch (e) {
    console.error("Proxy Audio Error:", e.message);
    res.status(500).json({ error: "Failed to fetch audio" });
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
  app.listen(PORT, () => console.log(`Server running on ${PORT}`));
}
