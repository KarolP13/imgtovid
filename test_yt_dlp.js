const YTDlpWrap = require('yt-dlp-wrap').default;
const ytDlpWrap = new YTDlpWrap('./yt-dlp');
async function run() {
  try {
    console.log("Downloading audio...");
    await ytDlpWrap.execPromise([
      'https://youtu.be/xVsa7whnDfU',
      '-f', 'bestaudio',
      '--no-playlist',
      '--extractor-args', 'youtube:player_client=ios,android,web',
      '--output', '/tmp/test_download.%(ext)s'
    ]);
    console.log("Success!");
  } catch(e) {
    console.error("Error:", e);
  }
}
run();
