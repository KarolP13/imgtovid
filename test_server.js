const { exec } = require('child_process');
const axios = require('axios');

const server = exec('node server/index.js', { env: { ...process.env, PORT: 3005, COBALT_API_URL: '' } });

server.stdout.on('data', data => console.log('SERVER STDOUT:', data.trim()));
server.stderr.on('data', data => console.error('SERVER STDERR:', data.trim()));

setTimeout(async () => {
  try {
    console.log('Sending request to /download...');
    await axios.get('http://localhost:3005/download?url=https://youtu.be/xVsa7whnDfU');
  } catch (e) {
    console.log('Request error (expected if it fails):', e.response?.data || e.message);
  } finally {
    server.kill();
  }
}, 2000);
