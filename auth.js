/* Omnicast account client. Authentication is performed by same-origin server
 * routes; this file never creates guest sessions or trusts browser user IDs. */
(function () {
    let session = null;
    let loaded = false;

    async function refreshSession() {
        try {
            const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
            const data = await response.json();
            session = response.ok && data.ok ? data.user : null;
        } catch (_) { session = null; }
        loaded = true;
        return session;
    }

    function login() { window.location.assign('/api/auth/google'); }

    async function logout() {
        try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }); }
        finally { session = null; window.location.assign('/index.html'); }
    }

    function buildButton(label, action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-ghost';
        button.textContent = label;
        button.style.cssText = 'border:1px solid currentColor;border-radius:999px;padding:.4rem .75rem;background:transparent;color:inherit;font:inherit;cursor:pointer;';
        button.addEventListener('click', action);
        return button;
    }

    async function mountAccountWidget(targetId) {
        const target = document.getElementById(targetId);
        if (!target) return null;
        if (!loaded) await refreshSession();
        target.replaceChildren();
        if (session) {
            const label = document.createElement('span');
            label.className = 'omnicast-account-label';
            label.textContent = session.email || 'Omnicast account';
            target.append(label, buildButton('Sign out', logout));
        } else {
            target.append(buildButton('Sign in with Google', login));
        }
        return session;
    }

    async function mountChannelSelector(targetId) {
        const target = document.getElementById(targetId);
        if (!target) return null;
        const user = await refreshSession();
        target.replaceChildren();
        if (!user) return null;
        try {
            const response = await fetch('/api/youtube-channels', { credentials: 'same-origin', cache: 'no-store' });
            const data = await response.json();
            if (!response.ok || !data.ok || !Array.isArray(data.channels) || data.channels.length < 2) return data.selectedChannelId || null;
            const select = document.createElement('select');
            select.className = 'omnicast-channel-select';
            select.setAttribute('aria-label', 'Active YouTube channel');
            select.style.cssText = 'max-width:180px;border:1px solid currentColor;border-radius:8px;padding:.35rem;background:#171307;color:inherit;';
            for (const channel of data.channels) {
                const option = document.createElement('option');
                option.value = channel.id;
                option.textContent = channel.title || channel.id;
                option.selected = channel.id === data.selectedChannelId;
                select.appendChild(option);
            }
            select.addEventListener('change', async () => {
                select.disabled = true;
                try {
                    const result = await fetch('/api/youtube-channel-select', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: select.value }) });
                    const body = await result.json();
                    if (!result.ok || !body.ok) throw new Error(body.error || 'Unable to switch channels.');
                    window.dispatchEvent(new Event('omnicast-channel-changed'));
                } catch (error) { window.alert(error.message); }
                finally { select.disabled = false; }
            });
            target.appendChild(select);
            return data.selectedChannelId || null;
        } catch (_) { return null; }
    }

    window.AuthStore = Object.freeze({
        login,
        signup: login,
        register: login,
        logout,
        refreshSession,
        getSession: () => session,
        requireAuth: async (returnTo = window.location.pathname) => {
            const user = await refreshSession();
            if (!user) { sessionStorage.setItem('omnicast-return-to', returnTo); login(); return false; }
            return true;
        },
        redirectIfAuthenticated: async () => !!(await refreshSession()),
        mountAccountWidget,
        mountChannelSelector,
        getAppPath: () => '/home.html',
        getHomePath: () => '/index.html'
    });
})();
