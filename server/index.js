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
// Download high-resolution 4K covers via iTunes Search API
app.get("/download-high-res-cover", async (req, res) => {
  const { artist, track, album, url } = req.query;
  try {
    let targetUrl = url;

    // We can try to get the 4K version if artist and track are provided
    if (artist && track) {
      console.log(`4K Cover requested for: "${artist} - ${track}" (Album: "${album || 'None'}")`);

      let searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(artist + " " + track + (album ? " " + album : ""))}&media=music&limit=5`;
      let searchRes = await axios.get(searchUrl);

      // If no results with album, fallback to just artist and track
      if (!searchRes.data.results || searchRes.data.results.length === 0) {
        searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(artist + " " + track)}&media=music&limit=5`;
        searchRes = await axios.get(searchUrl);
      }

      if (searchRes.data.results && searchRes.data.results.length > 0) {
        let bestItem = searchRes.data.results[0]; // Default to top result

        // If we have an album name, try to find the exact matching collection to avoid Deluxe/Compilation mixups
        if (album) {
          const albumLower = album.toLowerCase();

          const perfectMatch = searchRes.data.results.find(r => r.collectionName && r.collectionName.toLowerCase() === albumLower);

          if (perfectMatch) {
            bestItem = perfectMatch;
          } else {
            // Aggressive bidirectional fuzzy match: Strip non-alphanumeric chars
            const cleanAlb = albumLower.replace(/[^a-z0-9]/g, '');
            const partialMatch = searchRes.data.results.find(r => {
              if (!r.collectionName) return false;
              const cleanCol = r.collectionName.toLowerCase().replace(/[^a-z0-9]/g, '');
              return cleanCol.includes(cleanAlb) || cleanAlb.includes(cleanCol);
            });
            if (partialMatch) bestItem = partialMatch;
          }
        }

        if (bestItem.artworkUrl100) {
          targetUrl = bestItem.artworkUrl100.replace('100x100bb', '10000x10000bb');
          console.log(`Found 4K iTunes artwork for collection "${bestItem.collectionName}": ${targetUrl}`);
        }
      }
    }

    if (!targetUrl) return res.status(400).send("No image URL could be resolved.");

    // Fetch the image as a stream
    const response = await axios.get(targetUrl, { responseType: 'stream' });

    // Determine a filename
    const cleanName = `${artist || 'unknown'}_${track || 'cover'}`.replace(/[^a-z0-9]/gi, '_');
    const filename = `${cleanName}_4k.jpg`;

    res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');

    response.data.pipe(res);
  } catch (e) {
    console.error("4K Cover Error:", e.message);
    res.status(500).json({ error: "Failed to fetch high-res cover" });
  }
});

// Extract cover image from any Spotify or SoundCloud URL
app.get("/extract-cover", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing url" });

  try {
    if (url.includes('spotify.com') || url.includes('spotify:')) {
      const match = url.match(/(?:track\/|spotify:track:)([a-zA-Z0-9]+)/);
      const id = match ? match[1] : null;
      if (id) {
        const token = await getSpotifyToken();
        const result = await axios.get(`https://api.spotify.com/v1/tracks/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const trackData = result.data;
        const artist = trackData.artists[0]?.name || '';
        const trackName = trackData.name || '';
        const albumName = trackData.album?.name || '';
        const fallbackUrl = trackData.album.images[0]?.url || '';

        // Redirect to our 4K cover finder
        return res.redirect(`/download-high-res-cover?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(trackName)}&album=${encodeURIComponent(albumName)}&url=${encodeURIComponent(fallbackUrl)}`);
      }
    } else {
      // Fallback: use yt-dlp to get thumbnail
      const YTDlpWrap = require('yt-dlp-wrap').default;
      const binaryPath = path.resolve(__dirname, '..', 'yt-dlp');
      const ytDlpWrap = new YTDlpWrap(binaryPath);

      const metadataStr = await ytDlpWrap.execPromise([url, '--dump-json', '--no-playlist']);
      const metadata = JSON.parse(metadataStr);

      if (metadata.thumbnail) {
        const cleanName = (metadata.title || 'cover').replace(/[^a-z0-9]/gi, '_');
        const filename = `${cleanName}_cover.jpg`;

        const response = await axios.get(metadata.thumbnail, { responseType: 'stream' });
        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return response.data.pipe(res);
      } else {
        return res.status(404).json({ error: "No thumbnail found for this URL" });
      }
    }
  } catch (e) {
    console.error("Extract Cover Error:", e.message);
    res.status(500).json({ error: "Failed to extract cover" });
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

          console.log(`Searching SoundCloud for top 10 results for: ${title}`);
          const searchMetadataStr = await ytDlpWrap.execPromise([
            `scsearch10:${title}`,
            '--dump-json',
            '--flat-playlist',
            '--cache-dir', '/tmp/yt-dlp-cache'
          ]);

          const results = searchMetadataStr.split('\n').filter(line => line.trim()).map(line => {
            try { return JSON.parse(line); } catch (e) { return null; }
          }).filter(Boolean);

          if (results.length === 0) {
            throw new Error("No SoundCloud results found.");
          }

          // Smart Ranking Algorithm
          // We want the studio version, not a live cover.
          const badKeywords = ['live', 'cover', 'session', 'remix', 'instrumental', 'karaoke', 'acoustic', 'slowed', 'reverb', 'sped up', 'type beat', '8d', 'mashup', 'rough', 'flip', 'edit', 'mix'];

          let bestResult = results[0];
          let bestScore = -1000;

          const officialArtistLower = trackData.artists[0].name.toLowerCase();
          const trackNameLower = trackData.name.toLowerCase();
          const officialDurationSec = trackData.duration_ms / 1000;

          for (const res of results) {
            let score = 0;
            const resTitle = (res.title || '').toLowerCase();
            const resUploader = (res.uploader || '').toLowerCase();
            const resDuration = res.duration || 0; // yt-dlp flat-playlist duration is in seconds

            // Penalize bad keywords heavily (unless the official track name already has it, like a remix)
            badKeywords.forEach(kw => {
              if (resTitle.includes(kw) && !trackNameLower.includes(kw)) score -= 200;
            });

            // Reward exact title matches
            if (resTitle.includes(trackNameLower)) score += 50;
            if (resTitle.includes(officialArtistLower)) score += 50;

            // Reward official accounts: Does the uploader name exactly match the Spotify artist?
            if (resUploader.includes(officialArtistLower) || officialArtistLower.includes(resUploader)) {
              score += 150;
            }

            // Duration check: Penalize heavily if the lengths don't match (prevents downloading 1h mixes or loop videos)
            // Allow a 15 second tolerance for intro/outro padding
            if (resDuration > 0 && officialDurationSec > 0) {
              const diff = Math.abs(resDuration - officialDurationSec);
              if (diff <= 5) score += 100; // Perfect match
              else if (diff <= 15) score += 50; // Close match
              else score -= (diff * 2); // Heavy penalty for large deviations
            }

            if (score > bestScore) {
              bestScore = score;
              bestResult = res;
            }
          }

          // Quality Confidence Threshold Check
          // If the best score is less than 0, it means EVERY track in the top 10 was heavily penalized 
          // (e.g. they were all Live versions, remixed, or severely duration-mismatched).
          // We should reject the download rather than giving the user a fan edit.
          if (bestScore < 0) {
            console.log(`Smart Search Rejected: Best candidate "${bestResult.title}" had failing score of ${bestScore}`);
            throw new Error("No clean studio version of this track exists on SoundCloud. All available results are live performances, remixes, or fan edits.");
          }

          downloadTarget = bestResult.url || bestResult.webpage_url;
          title = bestResult.title || title; // Update title to actual downloaded track

          console.log(`Smart Search Selected: ${title} (Score: ${bestScore}) -> ${downloadTarget}`);
        } catch (e) {
          console.error("Spotify meta error:", e.message);
          if (e.message.includes("No clean studio version") || e.message.includes("No SoundCloud results found")) {
            throw new Error(e.message); // Preserve algorithm rejection message
          }
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

    // Vercel only allows writing to /tmp, and yt-dlp ignores --paths when outputting to stdout
    // so we must save the full file to /tmp first, then stream it.
    const tmpBaseName = `${Date.now()}_audio`;
    const tmpFilePathBase = `/tmp/${tmpBaseName}`;

    console.log(`Downloading to temp file prefix: ${tmpFilePathBase}`);

    try {
      await ytDlpWrap.execPromise([
        downloadTarget,
        '-f', 'bestaudio',
        '--no-playlist',
        '--max-downloads', '1',
        '--cache-dir', '/tmp/yt-dlp-cache',
        '--output', `${tmpFilePathBase}.%(ext)s`
      ]).catch(execErr => {
        // Ignored warning check: if any file starting with our prefix exists in /tmp, download succeeded.
        const files = fs.readdirSync('/tmp/');
        const exists = files.some(f => f.startsWith(tmpBaseName) && !f.endsWith('.part'));
        if (!exists) {
          throw execErr;
        }
        console.log("yt-dlp threw a non-fatal warning, but file exists. Proceeding.");
      });

      console.log("yt-dlp download complete. Locating output file...");

      const tmpFiles = fs.readdirSync('/tmp/');
      const actualFilename = tmpFiles.find(f => f.startsWith(tmpBaseName) && !f.endsWith('.part') && !f.endsWith('.ytdl'));

      if (!actualFilename) {
        throw new Error("Download completed but no final audio file was found in /tmp!");
      }

      const finalPath = path.join('/tmp', actualFilename);
      console.log(`Found actual streamable file: ${finalPath}`);

      const readStream = fs.createReadStream(finalPath);
      readStream.pipe(res);

      readStream.on('end', () => {
        fs.unlink(finalPath, (err) => {
          if (err) console.error("Failed to cleanup temp file:", err);
        });
      });

      readStream.on('error', (err) => {
        console.error("Read stream error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Failed to stream audio file", detail: err.message });
      });

    } catch (execErr) {
      console.error("yt-dlp exec error:", execErr);
      if (!res.headersSent) res.status(500).json({ error: "Download process failed", detail: execErr.message });
    }

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
