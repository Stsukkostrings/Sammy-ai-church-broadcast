const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'storage-scope.js'), 'utf8');
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function createStorageHarness(initialScope = USER_A) {
    const values = new Map();
    const listeners = new Map();
    const channels = [];
    let cookieScope = initialScope;
    let intervalCallback;
    let reloads = 0;
    const localStorage = {
        get length() { return values.size; },
        key(index) { return [...values.keys()][index] ?? null; },
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(String(key), String(value)); },
        removeItem(key) { values.delete(String(key)); }
    };
    class FakeBroadcastChannel {
        constructor(name) { this.name = name; channels.push(this); }
        addEventListener() {}
        postMessage() {}
        close() {}
    }
    const window = {
        localStorage,
        BroadcastChannel: FakeBroadcastChannel,
        location: { reload() { reloads += 1; } },
        addEventListener(name, callback) { listeners.set(`window:${name}`, callback); },
        removeEventListener(name) { listeners.delete(`window:${name}`); },
        dispatchEvent(event) { listeners.get(`window:${event.type}`)?.(event); },
        setInterval(callback) { intervalCallback = callback; return 1; }
    };
    const document = {
        documentElement: { style: {} },
        get cookie() { return cookieScope ? `omni_scope=${cookieScope}` : ''; },
        addEventListener(name, callback) { listeners.set(`document:${name}`, callback); },
        removeEventListener(name) { listeners.delete(`document:${name}`); }
    };
    class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
    vm.runInNewContext(source, { window, document, localStorage, CustomEvent, BroadcastChannel: FakeBroadcastChannel });
    return {
        api: window.OmnicastStorage,
        values,
        channels,
        listeners,
        setScope(value) { cookieScope = value; },
        fireStorage(key) { listeners.get('window:storage')?.({ key }); },
        checkScope() { intervalCallback?.(); },
        get reloads() { return reloads; },
        get hidden() { return document.documentElement.style.visibility === 'hidden'; }
    };
}

test('scoped storage isolates accounts and preserves unrelated/legacy browser data', () => {
    const h = createStorageHarness(USER_A);
    h.values.set('third-party-preference', 'keep');
    h.values.set('omnicast_archive_sessions_v2', 'legacy-unscoped');
    h.api.setItem('draft', 'A private draft');
    assert.equal(h.api.getItem('draft'), 'A private draft');

    h.setScope(USER_B);
    assert.equal(h.api.getItem('draft'), null);
    h.api.setItem('draft', 'B private draft');
    assert.equal(h.api.getItem('draft'), 'B private draft');

    h.setScope(USER_A);
    assert.equal(h.api.getItem('draft'), 'A private draft');
    assert.equal(h.values.get('third-party-preference'), 'keep');
    assert.equal(h.values.get('omnicast_archive_sessions_v2'), 'legacy-unscoped');
});

test('storage events are delivered only for the active account namespace', () => {
    const h = createStorageHarness(USER_A);
    let received = 0;
    h.api.onStorage('overlay', () => { received += 1; });
    const keyA = `omnicast.scope.${USER_A}:overlay`;
    const keyB = `omnicast.scope.${USER_B}:overlay`;
    h.fireStorage(keyB);
    assert.equal(received, 0);
    h.fireStorage(keyA);
    assert.equal(received, 1);
    h.setScope(USER_B);
    h.fireStorage(keyA);
    assert.equal(received, 1);
    h.fireStorage(keyB);
    assert.equal(received, 2);
});

test('broadcast channels are namespaced and account changes reload stale pages', () => {
    const h = createStorageHarness(USER_A);
    const channelA = h.api.channel('overlay');
    assert.equal(channelA.name, `omnicast.scope.${USER_A}:overlay`);
    h.setScope(USER_B);
    const channelB = h.api.channel('overlay');
    assert.equal(channelB.name, `omnicast.scope.${USER_B}:overlay`);
    h.checkScope();
    assert.equal(h.reloads, 1);
    assert.equal(h.hidden, true);
});

test('app.js pages load storage scope before app code and protected overlay pages load it', () => {
    for (const file of ['index.html', 'home.html', 'studio.html', 'church_studio.html']) {
        const html = fs.readFileSync(path.join(root, file), 'utf8');
        assert.ok(html.indexOf('storage-scope.js') >= 0, `${file} includes scoped storage`);
        assert.ok(html.indexOf('storage-scope.js') < html.indexOf('app.js'), `${file} loads scoped storage first`);
    }
    for (const file of ['church_studio.html', 'lower-third.html', 'omnicast_lyrics.html']) {
        const html = fs.readFileSync(path.join(root, file), 'utf8');
        assert.match(html, /storage-scope\.js/);
    }
});
