/* Private browser storage namespaced by the signed-in Omnicast account.
 *
 * This is deliberately not an authorization boundary: the API and database
 * still enforce ownership with the Supabase user id. It prevents local drafts,
 * archives, lyrics, overlays and caches from leaking between accounts that use
 * the same browser profile.
 */
(function () {
    'use strict';
    const PREFIX = 'omnicast.scope.';
    function readCookie(name) {
        const parts = String(document.cookie || '').split(';');
        for (const part of parts) {
            const index = part.indexOf('=');
            if (index < 0) continue;
            if (part.slice(0, index).trim() !== name) continue;
            try { return decodeURIComponent(part.slice(index + 1).trim()); } catch (_) { return ''; }
        }
        return '';
    }

    function currentScope() {
        const value = String(readCookie('omni_scope') || '').toLowerCase();
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ? value : 'anonymous';
    }

    function storageKey(key) {
        return `${PREFIX}${currentScope()}:${String(key)}`;
    }

    function getItem(key) {
        try { return window.localStorage.getItem(storageKey(key)); } catch (_) { return null; }
    }

    function setItem(key, value) {
        try { window.localStorage.setItem(storageKey(key), String(value)); } catch (_) {}
    }

    function removeItem(key) {
        try { window.localStorage.removeItem(storageKey(key)); } catch (_) {}
    }

    function keyScope(rawKey) {
        const value = String(rawKey || '');
        if (!value.startsWith(PREFIX)) return null;
        const rest = value.slice(PREFIX.length);
        const separator = rest.indexOf(':');
        if (separator < 0) return null;
        return { scope: rest.slice(0, separator), key: rest.slice(separator + 1) };
    }

    function isKey(rawKey, key) {
        const parsed = keyScope(rawKey);
        return !!parsed && parsed.scope === currentScope() && parsed.key === String(key);
    }

    function onStorage(key, handler) {
        const listener = event => {
            if (isKey(event.key, key)) handler(event);
        };
        window.addEventListener('storage', listener);
        return () => window.removeEventListener('storage', listener);
    }

    function channel(key) {
        try {
            return 'BroadcastChannel' in window ? new BroadcastChannel(storageKey(key)) : null;
        } catch (_) { return null; }
    }

    function clearCurrent() {
        try {
            const prefix = `${PREFIX}${currentScope()}:`;
            const doomed = [];
            for (let i = 0; i < window.localStorage.length; i += 1) {
                const key = window.localStorage.key(i);
                if (key && key.startsWith(prefix)) doomed.push(key);
            }
            doomed.forEach(key => window.localStorage.removeItem(key));
        } catch (_) {}
    }

    let observedScope = currentScope();
    function observeScope() {
        const next = currentScope();
        if (next === observedScope) return;
        const previous = observedScope;
        observedScope = next;
        window.dispatchEvent(new CustomEvent('omnicast:scopechange', { detail: { previous, scope: next } }));
        // A tab may retain private DOM state after another tab changes the
        // shared account cookie. Reload before continuing under the new user.
        try { document.documentElement.style.visibility = 'hidden'; } catch (_) {}
        window.location.reload();
    }
    window.addEventListener('focus', observeScope);
    document.addEventListener('visibilitychange', observeScope);
    window.setInterval(observeScope, 250);

    window.OmnicastStorage = Object.freeze({
        getItem,
        setItem,
        removeItem,
        isKey,
        onStorage,
        channel,
        clearCurrent,
        scope: currentScope
    });
})();
