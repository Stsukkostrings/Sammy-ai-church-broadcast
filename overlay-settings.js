(function () {
    'use strict';

    const keySelect = document.getElementById('overlayKey');
    const statusNode = document.getElementById('overlayStatus');
    const messageNode = document.getElementById('overlayMessage');
    const createButton = document.getElementById('createTokenButton');
    const rotateButton = document.getElementById('rotateTokenButton');
    const revokeButton = document.getElementById('revokeTokenButton');
    const tokenPanel = document.getElementById('tokenPanel');
    const overlayUrl = document.getElementById('overlayUrl');
    const copyButton = document.getElementById('copyTokenButton');
    const previewLink = document.getElementById('previewOverlayLink');

    let user = null;

    function selectedKey() {
        return keySelect?.value === 'church' ? 'church' : 'lower-third';
    }

    function message(text, type = '') {
        if (!messageNode) return;
        messageNode.textContent = text || '';
        messageNode.className = `overlay-message${type ? ` is-${type}` : ''}`;
    }

    function setBusy(busy) {
        [createButton, rotateButton, revokeButton, copyButton].forEach(button => {
            if (button) button.disabled = Boolean(busy);
        });
    }

    function clearToken() {
        if (overlayUrl) overlayUrl.value = '';
        if (tokenPanel) tokenPanel.hidden = true;
        if (previewLink) previewLink.removeAttribute('href');
    }

    function dateLabel(value) {
        if (!value) return 'unknown';
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'unknown';
    }

    function renderChannel(channel) {
        const active = Boolean(channel?.tokenActive);
        if (statusNode) {
            statusNode.className = `overlay-status${active ? ' is-active' : ''}`;
            statusNode.textContent = active
                ? `Active token created ${dateLabel(channel.tokenCreatedAt)}${channel.tokenRotatedAt ? ` · last rotated ${dateLabel(channel.tokenRotatedAt)}` : ''}. The plaintext URL is not stored by OmniCast.`
                : 'No active token for this overlay channel. Generate one, then copy the URL into OBS.';
        }
        if (createButton) createButton.disabled = active;
        if (rotateButton) rotateButton.disabled = !active;
        if (revokeButton) revokeButton.disabled = !active;
    }

    async function request(method, body) {
        const response = await fetch(`/api/overlay-channel?key=${encodeURIComponent(selectedKey())}`, {
            method,
            credentials: 'same-origin',
            cache: 'no-store',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined
        });
        let data = null;
        try { data = await response.json(); } catch (_) {}
        if (!response.ok || !data?.ok) {
            throw new Error(data?.error || 'Unable to update the overlay link.');
        }
        return data;
    }

    async function load() {
        clearToken();
        if (!user) {
            if (statusNode) {
                statusNode.className = 'overlay-status is-error';
                statusNode.textContent = 'Sign in with your OmniCast account to manage OBS overlay links.';
            }
            if (createButton) createButton.disabled = true;
            if (rotateButton) rotateButton.disabled = true;
            if (revokeButton) revokeButton.disabled = true;
            return;
        }
        setBusy(true);
        message('Checking the current overlay channel...');
        try {
            const data = await request('GET');
            renderChannel(data.channel);
            message('');
        } catch (error) {
            if (statusNode) {
                statusNode.className = 'overlay-status is-error';
                statusNode.textContent = error.message;
            }
            message(error.message, 'error');
        } finally {
            if (user) setBusy(false);
            if (statusNode && user) {
                // setBusy(false) re-enables every button; restore channel state.
                const active = statusNode.classList.contains('is-active');
                if (createButton) createButton.disabled = active;
                if (rotateButton) rotateButton.disabled = !active;
                if (revokeButton) revokeButton.disabled = !active;
            }
        }
    }

    async function run(action) {
        if (!user) {
            message('Sign in before managing an overlay link.', 'error');
            return;
        }
        if (action === 'rotate' && !window.confirm('Rotate this token? The old OBS URL stops working immediately.')) return;
        if (action === 'revoke' && !window.confirm('Revoke this token? OBS will stop receiving updates immediately.')) return;

        setBusy(true);
        message(action === 'revoke' ? 'Revoking token...' : 'Generating a new token...');
        try {
            const data = await request('POST', { action, key: selectedKey() });
            renderChannel(data.channel);
            clearToken();
            if (data.token && data.url) {
                overlayUrl.value = data.url;
                previewLink.href = data.url;
                tokenPanel.hidden = false;
                message('Secure URL generated. Copy it now; it will not be shown again.', 'ok');
                overlayUrl.focus();
                overlayUrl.select();
            } else {
                message('Overlay token revoked. OBS will stop receiving updates after its next poll.', 'ok');
            }
        } catch (error) {
            message(error.message, 'error');
            await load();
        } finally {
            setBusy(false);
            if (statusNode) {
                const active = statusNode.classList.contains('is-active');
                if (createButton) createButton.disabled = active;
                if (rotateButton) rotateButton.disabled = !active;
                if (revokeButton) revokeButton.disabled = !active;
            }
        }
    }

    async function copyUrl() {
        if (!overlayUrl?.value) return;
        try {
            await navigator.clipboard.writeText(overlayUrl.value);
            message('Secure OBS URL copied.', 'ok');
        } catch (_) {
            overlayUrl.focus();
            overlayUrl.select();
            try {
                document.execCommand('copy');
                message('Secure OBS URL copied.', 'ok');
            } catch (__) {
                message('Select the URL and copy it manually.', 'error');
            }
        }
    }

    createButton?.addEventListener('click', () => run('create'));
    rotateButton?.addEventListener('click', () => run('rotate'));
    revokeButton?.addEventListener('click', () => run('revoke'));
    copyButton?.addEventListener('click', copyUrl);
    keySelect?.addEventListener('change', load);

    const queryKey = new URLSearchParams(window.location.search).get('key');
    if (keySelect && (queryKey === 'church' || queryKey === 'lower-third')) {
        keySelect.value = queryKey;
    }

    (async function init() {
        if (!window.AuthStore) {
            message('Account sign-in is unavailable.', 'error');
            return;
        }
        window.AuthStore.mountAccountWidget('omnicast-account-widget');
        user = await window.AuthStore.refreshSession();
        await load();
    })();
})();
