const axios = require('axios');

async function testCobalt() {
    console.log("Testing Cobalt API...");
    try {
        const url = "https://open.spotify.com/track/3TQ8Tv2XSKWzbwJQonTtT2";
        const res = await axios.post('https://api.cobalt.tools/api/json', {
            url: url,
            isAudioOnly: true
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        console.log("Cobalt Status:", res.status);
        console.log("Cobalt Data:", JSON.stringify(res.data, null, 2));

        if (res.data.url) {
            console.log("Download URL found:", res.data.url);
        } else {
            console.log("No download URL returned.");
        }

    } catch (e) {
        console.error("Cobalt Test Failed:", e.message);
        if (e.response) {
            console.log("Response Data:", e.response.data);
        }
    }
}

testCobalt();
