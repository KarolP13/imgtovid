const axios = require('axios');
const fs = require('fs');

async function testCobalt() {
  try {
    console.log("Requesting Cobalt Tunnel...");
    const res = await axios.post("https://cobalt-production-37d8.up.railway.app/", {
        url: "https://youtu.be/xVsa7whnDfU",
        aFormat: "mp3",
        isAudioOnly: true
    }, {
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        timeout: 10000
    });

    console.log("Cobalt Response:", res.data);

    if (res.data.url) {
        console.log("Fetching tunnel URL:", res.data.url);
        const audioRes = await axios.get(res.data.url, { responseType: 'stream', timeout: 30000 });
        console.log("Headers:", audioRes.headers);
        const writer = fs.createWriteStream("test_output.mp3");
        audioRes.data.pipe(writer);
        writer.on('finish', () => console.log('Download complete!'));
        writer.on('error', (e) => console.error('Write Error:', e.message));
    }
  } catch (error) {
    console.error("Error:", error.message, error.response?.data);
  }
}

testCobalt();
