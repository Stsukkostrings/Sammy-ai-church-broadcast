const fs = require('node:fs');

for (const file of ['api/youtube-auth.js', 'api/youtube-callback.js', 'api/youtube-channel.js', 'api/_youtubeCore.js']) {
    if (!fs.existsSync(file)) throw new Error(`${file} missing`);
}

const html = fs.readFileSync('spiritflow_creator_studio.html', 'utf8');
for (const match of html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) new Function(match[1]);
}
console.log('Smoke checks passed');
