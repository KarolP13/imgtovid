# CoverClip — Song Cover Video Generator

Automatically generates Twitter-ready MP4 videos from Spotify album art + audio. Search for any song, pick it, and download a 1280×1280 MP4 ready to post.

## How It Works

1. You search for an artist/song
2. The app fetches results from Spotify (album art + metadata + 30s preview)
3. You select a track (optionally upload the full MP3)
4. FFmpeg runs **in your browser** to combine image + audio → MP4
5. Download and post to Twitter

---

## Setup

### 1. Get Spotify API Credentials (Free)

1. Go to [developer.spotify.com](https://developer.spotify.com/dashboard)
2. Log in and click **Create App**
3. Set Redirect URI to `http://localhost:3000`
4. Copy your **Client ID** and **Client Secret**

### 2. Configure Environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:
```
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
PORT=3001
```

### 3. Install & Run

```bash
# Install root deps
npm install

# Install all dependencies
npm run install:all

# Run both frontend + backend together
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Audio Options

| Source | Duration | How |
|--------|----------|-----|
| Spotify Preview | 30 seconds | Automatic (if available) |
| Your MP3 | Full track | Click "Upload Full MP3" |

Most tweets work great with the 30s preview. For full songs, just drop in your MP3.

---

## Output Format

- **Resolution:** 1280×1280 (Twitter square format)
- **Video:** H.264 (libx264), still image loop
- **Audio:** AAC, 192kbps
- **Container:** MP4

---

## Tech Stack

- **Frontend:** React, ffmpeg.wasm (runs entirely in browser — no server upload needed)
- **Backend:** Express (proxies Spotify API to keep credentials safe)
- **Video:** FFmpeg WebAssembly

---

## Notes

- FFmpeg runs client-side, so generation speed depends on your machine
- Large files (long MP3s) may take 30–60 seconds to process
- The app requires `SharedArrayBuffer` support — Chrome/Edge work best
- No files are ever uploaded to any server
