import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import './App.css';

export default function App() {
  // Modes: 'spotify' | 'custom'
  const [appMode, setAppMode] = useState('custom');

  // Spotify State
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [customAudio, setCustomAudio] = useState(null);
  const [customAudioName, setCustomAudioName] = useState('');

  // Custom Mode State
  const [customCover, setCustomCover] = useState(null);
  const [customCoverName, setCustomCoverName] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customArtist, setCustomArtist] = useState('');

  // Downloader State
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadStatus, setDownloadStatus] = useState('idle');

  // General State
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [searching, setSearching] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const ffmpegRef = useRef(new FFmpeg());
  const audioInputRef = useRef(null);
  const coverInputRef = useRef(null);
  const searchTimeout = useRef(null);

  useEffect(() => { loadFFmpeg(); }, []);

  async function loadFFmpeg() {
    const ffmpeg = ffmpegRef.current;
    ffmpeg.on('progress', ({ progress }) => setProgress(Math.round(progress * 100)));
    try {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      setFfmpegLoaded(true);
    } catch (e) { console.error('FFmpeg load failed:', e); }
  }

  // --- Spotify Logic ---

  function extractSpotifyTrackId(url) {
    const match = url.match(/(?:track\/|spotify:track:)([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  async function handleSearchInput(e) {
    const val = e.target.value;
    setQuery(val);
    setErrorMsg('');

    clearTimeout(searchTimeout.current);

    // Check if it's a link immediately
    const trackId = extractSpotifyTrackId(val);
    if (trackId) {
      setSearching(true);
      try {
        const res = await fetch(`/track/${trackId}`);
        const data = await res.json();
        if (data.error) { setErrorMsg(data.detail || data.error); }
        else { selectTrack(data); setResults([]); } // Auto-select and clear results
      } catch (e) {
        setErrorMsg('Failed to look up track link.');
      }
      setSearching(false);
      return;
    }

    // Otherwise, treat as search query
    if (!val.trim()) { setResults([]); return; }

    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/search?q=${encodeURIComponent(val)}&type=track&limit=20`);

        if (!res.ok) {
          const text = await res.text();
          let errorDetail = `Server Error (${res.status})`;
          try {
            const json = JSON.parse(text);
            errorDetail = json.detail || json.error || errorDetail;
          } catch (e) {
            // If not JSON, use text subset
            if (text.length > 100) errorDetail += `: ${text.substring(0, 100)}...`;
            else errorDetail += `: ${text}`;
          }
          throw new Error(errorDetail);
        }

        const data = await res.json();
        if (data.error) {
          setErrorMsg(data.detail || data.error);
          setResults([]);
        } else {
          setResults(data.tracks?.items || []);
        }
      } catch (e) {
        console.error("Search error:", e);
        setErrorMsg(e.message);
        setResults([]);
      }
      setSearching(false);
    }, 400);
  }

  async function selectTrack(track) {
    setSelected(track);
    setVideoUrl(null);
    setCustomAudio(null);
    setCustomAudioName('');
    setStatus('idle');
    setProgress(0);
    setErrorMsg('');

    // Auto-fetch audio if preview is missing
    if (!track.preview_url) {
      try {
        setCustomAudioName('Fetching audio...');
        const artist = track.artists[0].name;
        const name = track.name;
        const res = await fetch(`/proxy-audio?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(name)}`);
        if (!res.ok) throw new Error('Audio not found');

        const blob = await res.blob();
        const file = new File([blob], "preview.m4a", { type: "audio/mp4" });
        setCustomAudio(file);
        setCustomAudioName('Auto-fetched Preview');
      } catch (e) {
        console.warn("Auto-audio fetch failed:", e);
        setCustomAudioName('');
      }
    }
  }

  // --- Custom Mode Logic ---

  function handleCustomCoverUpload(e) {
    const file = e.target.files[0];
    if (file) { setCustomCover(file); setCustomCoverName(file.name); }
  }

  // --- Shared Logic ---

  function handleAudioUpload(e) {
    const file = e.target.files[0];
    if (file) { setCustomAudio(file); setCustomAudioName(file.name); }
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      setCustomAudio(file);
      setCustomAudioName(file.name);
    }
  }

  function handleCoverDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setCustomCover(file);
      setCustomCoverName(file.name);
    }
  }

  async function handleDownload() {
    if (!downloadUrl) return;
    setDownloadStatus('downloading');
    setErrorMsg('');

    try {
      const res = await fetch(`/download?url=${encodeURIComponent(downloadUrl)}`);

      if (!res.ok) {
        // Try to parse error as JSON, otherwise read text
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await res.json();
          throw new Error(data.detail || data.error || 'Download failed');
        } else {
          const text = await res.text();
          console.error("Non-JSON Error Response:", text);
          const shortText = text.length > 200 ? text.substring(0, 200) + "..." : text;
          throw new Error(`Server Error (${res.status}): ${shortText}`);
        }
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const disposition = res.headers.get('Content-Disposition');
      let filename = 'audio.mp3';
      if (disposition && disposition.indexOf('attachment') !== -1) {
        const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
        const matches = filenameRegex.exec(disposition);
        if (matches != null && matches[1]) {
          filename = matches[1].replace(/['"]/g, '');
        }
      }

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setDownloadStatus('done');
      setTimeout(() => setDownloadStatus('idle'), 3000);
    } catch (e) {
      console.error(e);
      setErrorMsg(e.message);
      setDownloadStatus('error');
    }
  }

  async function generateVideo() {
    if (!ffmpegLoaded) { setErrorMsg('FFmpeg is still loading, please wait.'); setStatus('error'); return; }

    let coverBlob = null;
    let audioBlob = null;
    let finalTitle = 'video';

    // Prepare resources based on mode
    if (appMode === 'spotify') {
      if (!selected) return;
      const imageUrl = selected.album.images[0]?.url;
      if (!imageUrl) { setErrorMsg('No album art found.'); return; }

      // Fetch cover
      const imgRes = await fetch(imageUrl);
      coverBlob = await imgRes.blob();

      // Audio
      audioBlob = customAudio;
      if (!audioBlob && selected.preview_url) {
        const res = await fetch(selected.preview_url);
        audioBlob = await res.blob();
      }
      finalTitle = `${selected.artists[0]?.name}-${selected.name}`;
    } else {
      // Custom Mode
      if (!customCover) { setErrorMsg('Please upload a cover image.'); return; }
      if (!customAudio) { setErrorMsg('Please upload an audio file.'); return; }
      coverBlob = customCover;
      audioBlob = customAudio;
      finalTitle = `${customArtist || 'artist'}-${customTitle || 'track'}`;
    }

    if (!audioBlob) { setErrorMsg('No audio available.'); setStatus('error'); return; }
    if (audioBlob.size < 1000) { setErrorMsg("Audio file is too small or empty."); setStatus('error'); return; }

    setStatus('generating');
    setProgress(0);
    setVideoUrl(null);
    setErrorMsg('');

    try {
      const ffmpeg = ffmpegRef.current;

      await ffmpeg.writeFile('cover.jpg', await fetchFile(coverBlob));

      const ext = audioBlob.type.includes('mp4') || audioBlob.name?.endsWith('.m4a') ? 'm4a' : 'mp3';
      await ffmpeg.writeFile(`audio.${ext}`, await fetchFile(audioBlob));

      await ffmpeg.exec([
        '-loop', '1', '-i', 'cover.jpg', '-i', `audio.${ext}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k', '-pix_fmt', 'yuv420p',
        '-vf', 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2:black',
        '-shortest', 'output.mp4'
      ]);

      const data = await ffmpeg.readFile('output.mp4');
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setStatus('done');

      // Store title for download via window or ref (simple hack for this component)
      window.currentVideoTitle = finalTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    } catch (e) {
      console.error(e);
      setErrorMsg(e.message || 'Video generation failed.');
      setStatus('error');
    }
  }

  function downloadVideo() {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `${window.currentVideoTitle || 'coverclip_video'}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">COVERCLIP</span>
          </div>
          <p className="tagline">Search. Generate. Post.</p>
        </div>
      </header>

      <main className="main">
        {/* Top-level Mode Switch */}
        <div className="mode-switch">
          <button className={appMode === 'spotify' ? 'active' : ''} onClick={() => { setAppMode('spotify'); setErrorMsg(''); }}>
            Spotify Search
          </button>
          <button className={appMode === 'custom' ? 'active' : ''} onClick={() => { setAppMode('custom'); setErrorMsg(''); }}>
            Custom Creation
          </button>
          <button className={appMode === 'downloader' ? 'active' : ''} onClick={() => { setAppMode('downloader'); setErrorMsg(''); }}>
            MP3 Downloader
          </button>
        </div>

        {/* SPOTIFY MODE */}
        {appMode === 'spotify' && (
          <>
            <div className="search-container unified">
              <span className="search-icon">⌕</span>
              <input
                className="search-input"
                placeholder="Search song or paste Spotify link..."
                value={query}
                onChange={handleSearchInput}
                autoFocus
              />
              {searching && <span className="search-spinner" />}
            </div>

            {errorMsg && <p className="top-error">⚠ {errorMsg}</p>}

            <div className="content-grid">
              {/* Results or Selection */}
              {query && !selected && (
                <section className="results-section">
                  <h2 className="section-label">RESULTS</h2>
                  {results.length === 0 && !searching && <p className="no-results">No results found.</p>}
                  <div className="tracks-grid">
                    {results.map(track => (
                      <button
                        key={track.id}
                        className={`track-card ${selected?.id === track.id ? 'selected' : ''}`}
                        onClick={() => selectTrack(track)}
                      >
                        <div className="track-art-wrap">
                          <img src={track.album.images[1]?.url || track.album.images[0]?.url} alt={track.album.name} className="track-art" />
                          {track.explicit && <span className="explicit-badge">E</span>}
                        </div>
                        <div className="track-info">
                          <p className="track-name">{track.name}</p>
                          <p className="track-artist">{track.artists[0].name}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {selected && (
                <section className="generate-section">
                  <h2 className="section-label">SELECTED TRACK</h2>
                  <div className="selected-card">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                      <img src={selected.album.images[0]?.url} alt={selected.album.name} className="selected-art" style={{ width: '100%', height: 'auto' }} />
                      <button className="text-btn" style={{ fontSize: '11px', padding: '4px' }} onClick={async () => {
                        try {
                          const res = await fetch(selected.album.images[0]?.url);
                          const blob = await res.blob();
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${selected.name.replace(/[^a-z0-9]/gi, '_')}_cover.jpg`;
                          a.click();
                          window.URL.revokeObjectURL(url);
                        } catch (e) {
                          console.error("Failed to download cover", e);
                        }
                      }}>↓ Download Cover</button>
                    </div>
                    <div className="selected-details">
                      <h3 className="selected-title">
                        {selected.name}
                        {selected.explicit && <span className="explicit-badge-inline">E</span>}
                      </h3>
                      <p className="selected-artist">{selected.artists.map(a => a.name).join(', ')}</p>
                      <p className="selected-album">{selected.album.name} · {selected.album.release_date?.slice(0, 4)}</p>

                      <div
                        className={`audio-drop-zone ${isDragOver ? 'drag-over' : ''}`}
                        onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                        onDragLeave={() => setIsDragOver(false)}
                        onDrop={handleDrop}
                      >
                        <div className="audio-status">
                          {customAudioName ? (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span className="status-good">✓ {customAudioName}</span>
                              {customAudioName === 'Auto-fetched Preview' && <span style={{ fontSize: '10px', color: '#666' }}>30s Preview (Upload MP3 for full length)</span>}
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span className={selected.preview_url ? "status-ok" : "status-warn"}>
                                {selected.preview_url ? "✓ Spotify Preview (30s)" : "No Preview"}
                              </span>
                              <span style={{ fontSize: '10px', color: '#666' }}>Upload MP3 for full length</span>
                            </div>
                          )}
                        </div>
                        <div className="audio-actions">
                          <span className="drop-hint">Drag MP3 here or</span>
                          <button className="text-btn" onClick={() => audioInputRef.current.click()}>browse</button>
                        </div>
                        <input ref={audioInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleAudioUpload} />
                      </div>

                    </div>
                  </div>
                  <ActionArea status={status} progress={progress} videoUrl={videoUrl} errorMsg={errorMsg} generateVideo={generateVideo} downloadVideo={downloadVideo} ffmpegLoaded={ffmpegLoaded} onReset={() => { setStatus('idle'); setVideoUrl(null); }} />
                </section>
              )}
            </div>
          </>
        )}

        {/* CUSTOM MODE */}
        {appMode === 'custom' && (
          <div className="wrapper-custom">
            <section className="custom-form">
              <h2 className="section-label">CUSTOM DETAILS</h2>
              <div className="input-group">
                <label>Track Title</label>
                <input className="text-input" placeholder="Enter song title" value={customTitle} onChange={e => setCustomTitle(e.target.value)} />
              </div>
              <div className="input-group">
                <label>Artist Name</label>
                <input className="text-input" placeholder="Enter artist name" value={customArtist} onChange={e => setCustomArtist(e.target.value)} />
              </div>
            </section>

            <div className="custom-media-grid">
              <section className="media-upload">
                <h2 className="section-label">COVER IMAGE</h2>
                <div className="upload-box" onClick={() => coverInputRef.current.click()} onDrop={handleCoverDrop} onDragOver={e => e.preventDefault()}>
                  {customCover ? (
                    <div className="preview-cover-wrap">
                      <img src={URL.createObjectURL(customCover)} className="preview-cover" alt="cover" />
                      <span className="change-btn">Change Image</span>
                    </div>
                  ) : (
                    <div className="placeholder">
                      <span className="plus">+</span>
                      <p>Upload Cover</p>
                    </div>
                  )}
                  <input ref={coverInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCustomCoverUpload} />
                </div>
              </section>

              <section className="media-upload">
                <h2 className="section-label">AUDIO FILE</h2>
                <div className="upload-box audio-box" onClick={() => audioInputRef.current.click()} onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
                  {customAudio ? (
                    <div className="audio-file-ui">
                      <span className="file-icon">♫</span>
                      <p className="file-name">{customAudioName}</p>
                      <span className="change-btn">Change Audio</span>
                    </div>
                  ) : (
                    <div className="placeholder">
                      <span className="plus">+</span>
                      <p>Upload MP3/Audio</p>
                    </div>
                  )}
                  <input ref={audioInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleAudioUpload} />
                </div>
              </section>
            </div>

            <section className="generate-section-custom">
              <ActionArea status={status} progress={progress} videoUrl={videoUrl} errorMsg={errorMsg} generateVideo={generateVideo} downloadVideo={downloadVideo} ffmpegLoaded={ffmpegLoaded} onReset={() => { setStatus('idle'); setVideoUrl(null); }} />
            </section>
          </div>
        )}

        {/* DOWNLOADER MODE */}
        {appMode === 'downloader' && (
          <div className="wrapper-custom">
            <section className="custom-form">
              <h2 className="section-label">MP3 DOWNLOADER</h2>
              <p style={{ fontSize: '12px', color: '#666', marginBottom: '16px' }}>Paste a Spotify or SoundCloud link to download the MP3.</p>
              <div className="input-group">
                <label>Track Link</label>
                <input
                  className="text-input"
                  placeholder="https://open.spotify.com/track/..."
                  value={downloadUrl}
                  onChange={e => setDownloadUrl(e.target.value)}
                />
              </div>
              <div className="action-area" style={{ marginTop: '16px' }}>
                {downloadStatus !== 'downloading' && (
                  <button className="generate-btn" onClick={handleDownload} disabled={!downloadUrl}>
                    {downloadStatus === 'done' ? '✓ Downloaded!' : 'Download MP3'}
                  </button>
                )}
                {downloadStatus === 'downloading' && (
                  <div className="progress-wrap">
                    <div className="progress-bar-track">
                      <div className="progress-bar-fill" style={{ width: `100%`, animation: 'pulse 1.5s infinite' }} />
                    </div>
                    <p className="progress-label">Fetching & Converting...</p>
                  </div>
                )}
                {errorMsg && <p className="error-msg">⚠ {errorMsg}</p>}
              </div>
            </section>
          </div>
        )}

      </main>
      <div className="version-badge">v1.0.17</div>
    </div>
  );
}

function ActionArea({ status, progress, videoUrl, errorMsg, generateVideo, downloadVideo, ffmpegLoaded, onReset }) {
  function handleTwitterShare() {
    const text = `Check out this video I made with CoverClip! 🎵✨ @youtube #MusicVideo`;
    const url = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text);
    window.open(url, '_blank');
  }

  return (
    <div className="action-area">
      {(status === 'idle' || status === 'error') && (
        <button className="generate-btn" onClick={generateVideo} disabled={!ffmpegLoaded}>
          {!ffmpegLoaded ? 'Loading Engine...' : 'Generate Video (Fast)'}
        </button>
      )}
      {status === 'generating' && (
        <div className="progress-wrap">
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="progress-label">Rendering... {progress}%</p>
        </div>
      )}
      {status === 'done' && (
        <div className="done-area">
          <video className="video-preview" src={videoUrl} controls loop />
          <div className="done-actions">
            <button className="download-btn" onClick={downloadVideo}>↓ Download MP4</button>
            <button className="twitter-btn" onClick={handleTwitterShare}>
              🐦 Post to Twitter
            </button>
          </div>
          <button className="reset-btn" onClick={onReset}>Reset / New</button>
        </div>
      )}
      {status === 'error' && <p className="error-msg">⚠ {errorMsg}</p>}
    </div>
  );
}
