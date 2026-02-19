const axios = require('axios');

async function testSpotisaver() {
    const spotifyId = "3TQ8Tv2XSKWzbwJQonTtT2";
    console.log(`Testing Spotisaver for ID: ${spotifyId}`);

    try {
        // 1. Get Metadata
        const metaUrl = `https://spotisaver.net/api/get_playlist.php?id=${spotifyId}&type=track&lang=en`;
        console.log(`Fetching metadata: ${metaUrl}`);
        const metaRes = await axios.get(metaUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://spotisaver.net/'
            }
        });

        console.log("Metadata Status:", metaRes.status);
        if (typeof metaRes.data !== 'object') {
            console.log("Metadata is NOT JSON. Preview:", metaRes.data.toString().substring(0, 100));
            return;
        }
        console.log("Metadata Track Name:", metaRes.data.tracks?.[0]?.name);

        const trackData = metaRes.data.tracks[0];

        // 2. Download
        console.log("Attempting download...");
        const downloadRes = await axios.post('https://spotisaver.net/api/download_track.php', {
            track: trackData,
            download_dir: "downloads",
            filename_tag: "SPOTISAVER",
            user_ip: "127.0.0.1",
            is_premium: false
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://spotisaver.net/',
                'Origin': 'https://spotisaver.net'
            },
            responseType: 'text' // Change to text to see error message if it's HTML
        });

        console.log("Download Response Status:", downloadRes.status);
        console.log("Download Response Content-Type:", downloadRes.headers['content-type']);
        console.log("Download Response Preview:", downloadRes.data.substring(0, 200));

    } catch (e) {
        console.error("Error encountered:");
        if (e.response) {
            console.log("Status:", e.response.status);
            console.log("Data Preview:", e.response.data.toString().substring(0, 200));
        } else {
            console.log(e.message);
        }
    }
}

testSpotisaver();
