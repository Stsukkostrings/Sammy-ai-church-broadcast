/* Browser side of the OBS relay. Studio pages publish to their own authenticated
 * account channel. OBS pages poll the public read endpoint with their channel
 * token, so they do not need the studio's login session or browser storage. */
(function () {
    'use strict';

    const VALID_KEYS = new Set(['lower-third', 'church']);
    const publishQueues = new Map();

    function tokenFromLocation(search = window.location.search) {
        const params = new URLSearchParams(search || '');
        return params.get('token') || params.get('overlayToken') || '';
    }

    function pageUrl(overlayKey, token) {
        if (!VALID_KEYS.has(overlayKey)) return '';
        const relative = overlayKey === 'church'
            ? 'church_studio.html?overlay=lower-third'
            : 'lower-third.html';
        const url = new URL(relative, window.location.href);
        url.searchParams.set('token', String(token || ''));
        return url.toString();
    }

    async function send(overlayKey, payload) {
        if (!VALID_KEYS.has(overlayKey) || !payload || typeof payload !== 'object') return false;
        try {
            const response = await fetch('/api/overlay-publish', {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: overlayKey, payload })
            });
            if (!response.ok) return false;
            const data = await response.json().catch(() => null);
            return Boolean(data?.ok);
        } catch (_) {
            return false;
        }
    }

    function publish(overlayKey, payload) {
        if (!VALID_KEYS.has(overlayKey)) return Promise.resolve(false);
        const previous = publishQueues.get(overlayKey) || Promise.resolve();
        const next = previous.catch(() => false).then(() => send(overlayKey, payload));
        publishQueues.set(overlayKey, next);
        next.finally(() => {
            if (publishQueues.get(overlayKey) === next) publishQueues.delete(overlayKey);
        });
        return next;
    }

    function poll(token, onOverlay, onError) {
        if (!token) return () => {};
        let stopped = false;
        let timer = null;
        let inFlight = false;
        let lastRevision = -1;
        let failures = 0;

        function schedule(delay) {
            if (!stopped) timer = window.setTimeout(tick, delay);
        }

        async function tick() {
            if (stopped || inFlight) return;
            inFlight = true;
            try {
                const response = await fetch(`/api/overlay-public?token=${encodeURIComponent(token)}`, {
                    method: 'GET',
                    credentials: 'omit',
                    cache: 'no-store',
                    headers: { Accept: 'application/json' }
                });
                if (response.status === 404 || response.status === 401 || response.status === 403) {
                    stopped = true;
                    if (timer) window.clearTimeout(timer);
                    onError?.('Overlay link is invalid or has been revoked.', response.status);
                    return;
                }
                if (!response.ok) {
                    failures += 1;
                    schedule(response.status === 429 ? 5000 : Math.min(15000, 1500 * failures));
                    return;
                }
                const data = await response.json().catch(() => null);
                if (data?.ok && data.overlay) {
                    failures = 0;
                    const revision = Number(data.overlay.revision) || 0;
                    if (revision !== lastRevision) {
                        lastRevision = revision;
                        onOverlay?.(data.overlay);
                    }
                }
                schedule(1000);
            } catch (_) {
                failures += 1;
                schedule(Math.min(15000, 2000 * failures));
            } finally {
                inFlight = false;
            }
        }

        tick();
        return () => {
            stopped = true;
            if (timer) window.clearTimeout(timer);
        };
    }

    window.OmnicastOverlayRelay = Object.freeze({
        publish,
        poll,
        tokenFromLocation,
        pageUrl
    });
})();
