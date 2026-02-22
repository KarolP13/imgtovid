const axios = require('axios');

async function testCobalt() {
  try {
    const res = await axios.post('https://api.cobalt.tools', {
      url: 'https://youtube.com/watch?v=xVsa7whnDfU'
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': 'https://cobalt.tools',
        'Referer': 'https://cobalt.tools/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      }
    });

    console.log("Success:", res.data);
    
    // Test the stream
    if (res.data && res.data.url) {
      console.log(`Downloading from: \${res.data.url}`);
      const audioRes = await axios.get(res.data.url, { responseType: 'stream', headers: { 'User-Agent': 'Mozilla/5.0'} });
      console.log(`Stream connected! Status: \${audioRes.status}`);
    }

  } catch (e) {
    if (e.response) {
      console.error("HTTP Error:", e.response.status, e.response.statusText);
      console.error("Data:", e.response.data);
    } else {
      console.error("Error:", e.message);
    }
  }
}

testCobalt();
