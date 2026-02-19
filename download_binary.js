const fs = require('fs');
const path = require('path');
const axios = require('axios');

(async () => {
    try {
        console.log('Detecting platform for yt-dlp download...');
        const platform = process.platform;
        let binaryName = 'yt-dlp'; // Default zipapp

        if (platform === 'linux') {
            binaryName = 'yt-dlp_linux'; // Standalone for Vercel
        } else if (platform === 'darwin') {
            binaryName = 'yt-dlp_macos'; // Standalone for Mac
        } else if (platform === 'win32') {
            binaryName = 'yt-dlp.exe';
        }

        console.log(`Platform: ${platform}. Downloading: ${binaryName}`);

        const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binaryName}`;
        const outputPath = path.resolve('yt-dlp'); // Save as 'yt-dlp' so code references match

        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(outputPath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log('Downloaded yt-dlp to ' + outputPath);

        // Ensure executable permissions
        if (platform !== 'win32') {
            fs.chmodSync(outputPath, '755');
            console.log('Set executable permissions.');
        }
    } catch (e) {
        console.error('Failed to download yt-dlp:', e.message);
        process.exit(1);
    }
})();
