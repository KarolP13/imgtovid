const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');

(async () => {
    try {
        console.log('Downloading yt-dlp binary...');
        // Download to current directory
        await YTDlpWrap.downloadFromGithub('yt-dlp');
        console.log('Downloaded yt-dlp to ' + path.resolve('yt-dlp'));

        // Ensure executable permissions
        if (process.platform !== 'win32') {
            fs.chmodSync('yt-dlp', '755');
            console.log('Set executable permissions.');
        }
    } catch (e) {
        console.error('Failed to download yt-dlp:', e);
        process.exit(1);
    }
})();
