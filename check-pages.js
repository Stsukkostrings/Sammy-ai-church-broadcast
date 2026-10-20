/*
 Focused page checks for the SpiritFlow Sounds / Omnicast AI site.
 Run with: npm run check   (or: node check-pages.js)

 Verifies the things this project cannot get from a framework build:
   1. the radio experience + Omnicast AI entry points exist,
   2. every inline <script> in every page parses,
   3. every internal link on every page points at a file that exists,
   4. the homepage keeps its SpiritFlow + Omnicast landmarks,
   5. no unexpected hardcoded production domains were introduced.
*/

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const failures = [];
const notes = [];

function fail(msg) { failures.push(msg); }

/* 1. Required files ---------------------------------------------------- */
const requiredFiles = [
    'index.html',
    'spiritflow-sounds-radio.html',
    'spiritflow-radio.css',
    'spiritflow-player.js',
    'omnicast-ai.html',
    'channels4_profile.jpg',
    'channels4_banner.jpg',
    'api/spiritflow-config.js',
    'api/spiritflow/nowplaying.js',
    'api/_spiritFlowCore.js',
    'robots.txt',
    'sitemap.xml',
    'navbar.js',
    'style.css',
    'app.js',
    'auth.js'
];

requiredFiles.forEach((file) => {
    if (!fs.existsSync(path.join(ROOT, file))) fail(`missing required file: ${file}`);
});

/* 2 + 3. Inline scripts parse, internal links resolve ------------------ */
const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));

function extensionlessExists(target) {
    return fs.existsSync(path.join(ROOT, target))
        || fs.existsSync(path.join(ROOT, `${target}.html`))
        || fs.existsSync(path.join(ROOT, target.replace(/\/$/, '/index.html')));
}

htmlFiles.forEach((file) => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');

    /* inline scripts must parse */
    [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].forEach((m) => {
        const code = m[1].trim();
        if (!code) return;
        try {
            new Function(code);
        } catch (error) {
            fail(`${file}: inline script does not parse (${error.message})`);
        }
    });

    /* internal links must exist */
    const KNOWN_MISSING = {
        /* Pre-existing on the deployed site: the desktop installer binary is not
           in the repository and returns 404 in production too. The button is kept
           for parity and reported in the final project report. */
        'downloads/OmniCast-AI.exe': 'pre-existing: desktop installer binary is not in the repository'
    };
    [...html.matchAll(/(?:href|src)="([^"]+)"/g)].forEach((m) => {
        let target = m[1].trim();
        if (/^(https?:|\/\/|#|mailto:|tel:|data:|javascript:)/i.test(target)) return;
        target = target.split('#')[0].split('?')[0];
        if (!target) return;
        if (target.startsWith('/')) target = target.slice(1);
        if (KNOWN_MISSING[target]) {
            notes.push(`${file}: known missing target ${target} (${KNOWN_MISSING[target]})`);
            return;
        }
        if (!extensionlessExists(target)) fail(`${file}: broken internal reference -> ${m[1]}`);
    });
});

/* 4. Homepage landmarks ------------------------------------------------ */
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
[
    ['SpiritFlow brand in header', 'SpiritFlow <b>Sounds</b>'],
    ['radio player section', 'id="spiritflow-listen"'],
    ['player audio element', 'id="sfrAudio"'],
    ['play control', 'id="sfrPlayBtn"'],
    ['link to the dedicated radio page', 'href="spiritflow-sounds-radio.html"'],
    ['Omnicast AI section', 'id="omnicast"'],
    ['link to the Omnicast AI hub', 'href="omnicast-ai.html"'],
    ['Church Studio link', 'href="church_studio.html"'],
    ['Main Studio link', 'href="studio.html"'],
    ['Creator Studio link', 'href="spiritflow_creator_studio.html"'],
    ['shared player script', 'src="spiritflow-player.js"']
].forEach(([label, needle]) => {
    if (!index.includes(needle)) fail(`index.html is missing ${label} (${needle})`);
});

const radio = fs.readFileSync(path.join(ROOT, 'spiritflow-sounds-radio.html'), 'utf8');
[
    ['shared stylesheet', 'href="spiritflow-radio.css"'],
    ['shared player script', 'src="spiritflow-player.js"'],
    ['canonical tag', 'rel="canonical"'],
    ['way back to the homepage', 'href="index.html"']
].forEach(([label, needle]) => {
    if (!radio.includes(needle)) fail(`spiritflow-sounds-radio.html is missing ${label} (${needle})`);
});

/* 5. Domain policy: only the verified production origin may be hardcoded */
const ALLOWED_HOSTS = ['omnicast-ai.vercel.app'];
const scanned = htmlFiles.concat(['robots.txt', 'sitemap.xml']);
scanned.forEach((file) => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    [...text.matchAll(/https?:\/\/([a-z0-9.-]+)\//gi)].forEach((m) => {
        const host = m[1].toLowerCase();
        if (ALLOWED_HOSTS.includes(host)) return;
        if (/^(fonts\.(googleapis|gstatic)\.com|www\.youtube\.com|www\.youtube-nocookie\.com|open\.spotify\.com|audiomack\.com|www\.boomplay\.com|pagead2\.googlesyndication\.com|formsubmit\.co|cdn\.jsdelivr\.net)$/.test(host)) return;
        notes.push(`${file}: external host referenced: ${host}`);
    });
});

if (notes.length) {
    console.log('Notes:');
    notes.forEach((n) => console.log('  - ' + n));
}

if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:`);
    failures.forEach((f) => console.error('  x ' + f));
    process.exit(1);
}

console.log(`Page checks passed (${htmlFiles.length} HTML files, ${requiredFiles.length} required files).`);
