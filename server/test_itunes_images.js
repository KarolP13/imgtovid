const axios = require('axios');

async function checkImages() {
    console.log("Checking iTunes images...");
    try {
        const url = `https://itunes.apple.com/search?term=Drake&media=music&limit=1`;
        const res = await axios.get(url);

        const item = res.data.results[0];
        console.log("Original URL:", item.artworkUrl100);

        const resized = item.artworkUrl100?.replace('100x100', '600x600');
        console.log("Resized URL:", resized);

        // Test if resized URL is reachable
        try {
            const imgRes = await axios.head(resized);
            console.log("Resized Image Status:", imgRes.status);
        } catch (e) {
            console.error("Resized Image Failed:", e.message);
        }

    } catch (e) {
        console.error("Test failed:", e);
    }
}

checkImages();
