(function () {
    const UNAVAILABLE = 'Connect YouTube or upload YouTube Analytics data to begin.';
    const state = {
        user: null,
        channels: [],
        channel: null,
        analytics: null,
        dateRange: 'all',
        customStartDate: '',
        customEndDate: '',
        sortKey: 'views',
        sortDir: 'desc',
        page: 1,
        pageSize: 25,
        formatFilter: 'all',
        thumbnailProject: null,
        fabricCanvas: null,
        history: [],
        redo: []
    };

    const $ = id => document.getElementById(id);
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const number = value => Number(value || 0).toLocaleString();
    const percent = value => value === null || value === undefined ? 'Not available' : `${Number(value).toFixed(2)}%`;

    async function api(action, options = {}) {
        const response = await fetch(`/api/creatorflow?action=${encodeURIComponent(action)}${options.query || ''}`, {
            method: options.method || 'GET',
            credentials: 'include',
            headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
            const error = new Error(data.error || 'CreatorFlow request failed.');
            error.data = data;
            throw error;
        }
        return data;
    }

    function toast(message) {
        if (window.showToast) window.showToast(message);
        else console.log(message);
    }

    function injectShell() {
        document.title = 'CreatorFlow - YouTube Creator Intelligence & Thumbnail Studio';
        const brand = document.querySelector('.creator-nav h1');
        const subtitle = document.querySelector('.creator-nav p');
        if (brand) brand.innerHTML = 'CREATOR<span style="color:var(--lemon)">FLOW</span>';
        if (subtitle) subtitle.textContent = 'YouTube Intelligence Studio';
        const desktop = document.querySelector('.creator-nav .hidden.md\\:flex');
        const mobile = $('mobile-menu')?.querySelector('.px-4');
        const nav = [
            ['creatorflow-dashboard', 'Dashboard'],
            ['analytics', 'Analytics'],
            ['creatorflow-videos', 'Videos'],
            ['creatorflow-winners', 'Winners'],
            ['creatorflow-intelligence', 'Content Intelligence'],
            ['creatorflow-thumbnail-studio', 'Thumbnail Studio'],
            ['creatorflow-thumbnail-lab', 'Thumbnail Lab'],
            ['creatorflow-title-lab', 'Title Lab'],
            ['tools', 'SEO Studio'],
            ['calendar', 'Content Calendar'],
            ['creatorflow-reports', 'Reports'],
            ['creatorflow-youtube', 'YouTube Connection'],
            ['creatorflow-settings', 'Settings']
        ];
        if (desktop && !$('nav-creatorflow-dashboard')) {
            desktop.innerHTML = nav.map(([id, label]) => `<button onclick="CreatorFlowNavigate('${id}')" class="nav-link px-3 py-2 text-xs font-medium text-gray-300 rounded-lg" id="nav-${id}">${label}</button>`).join('');
        }
        if (mobile && !mobile.querySelector('[data-cf-mobile]')) {
            mobile.innerHTML = nav.map(([id, label]) => `<button data-cf-mobile onclick="CreatorFlowNavigate('${id}'); toggleMobileMenu()" class="block w-full text-left px-4 py-3 text-sm font-medium text-gray-300 hover:text-lemon hover:bg-lemon/5 rounded-lg">${label}</button>`).join('');
        }
        const main = document.querySelector('main');
        if (!main || $('creatorflow-dashboard')) return;
        main.insertAdjacentHTML('afterbegin', sectionsHtml());
        document.body.insertAdjacentHTML('beforeend', authHtml());
        bindEvents();
        if (window.lucide) window.lucide.createIcons();
    }

    function sectionsHtml() {
        return `
        <section id="creatorflow-dashboard" class="section-content">
            <div class="creatorflow-shell">
                <div class="creatorflow-panel">
                    <div class="flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <p class="text-lemon text-sm font-bold uppercase tracking-widest">CreatorFlow</p>
                            <h1 class="text-4xl font-black text-white">YouTube Creator Intelligence & Thumbnail Studio</h1>
                            <p class="creatorflow-muted mt-2">SpiritFlow Sounds is the first workspace, but analytics only appear after a real YouTube connection or CSV import.</p>
                        </div>
                        <div class="creatorflow-auth-actions">
                            <button class="btn-outline px-4 py-3 rounded-lg" data-cf-open-auth>Sign In</button>
                            <button class="btn-primary px-4 py-3 rounded-lg" onclick="showSection('creatorflow-youtube')">Connect / Import</button>
                        </div>
                    </div>
                </div>
                <div id="cf-unavailable" class="creatorflow-alert mt-4">${UNAVAILABLE}</div>
                <div class="creatorflow-panel mt-4">
                    <div class="creatorflow-auth-actions">
                        <button class="btn-outline px-3 py-2 rounded-lg" data-range="7">7 days</button>
                        <button class="btn-outline px-3 py-2 rounded-lg" data-range="28">28 days</button>
                        <button class="btn-outline px-3 py-2 rounded-lg" data-range="90">90 days</button>
                        <button class="btn-outline px-3 py-2 rounded-lg" data-range="365">365 days</button>
                        <button class="btn-primary px-3 py-2 rounded-lg" data-range="all">All time</button>
                        <input id="cf-custom-start" class="input-field px-3 py-2 rounded-lg" type="date">
                        <input id="cf-custom-end" class="input-field px-3 py-2 rounded-lg" type="date">
                        <button id="cf-custom-range" class="btn-outline px-3 py-2 rounded-lg">Custom</button>
                    </div>
                </div>
                <div class="creatorflow-grid metrics mt-4" id="cf-health-metrics"></div>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                    <div class="creatorflow-panel"><h3>Performance</h3><canvas id="cf-views-chart" height="130"></canvas></div>
                    <div class="creatorflow-panel"><h3>Next Moves</h3><div id="cf-next-moves" class="space-y-2 creatorflow-muted">${UNAVAILABLE}</div></div>
                    <div class="creatorflow-panel"><h3>Winners</h3><div id="cf-winner-list" class="space-y-2 creatorflow-muted">${UNAVAILABLE}</div></div>
                    <div class="creatorflow-panel"><h3>Content Intelligence</h3><div id="cf-pillar-list" class="space-y-2 creatorflow-muted">${UNAVAILABLE}</div></div>
                </div>
            </div>
        </section>
        <section id="creatorflow-videos" class="section-content"><div class="creatorflow-shell"><div class="creatorflow-panel"><h1 class="text-3xl font-black text-white mb-4">Video Leaderboard</h1><div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4"><input id="cf-video-search" class="input-field px-4 py-3 rounded-lg" placeholder="Search videos"><select id="cf-video-format" class="input-field px-4 py-3 rounded-lg"><option value="all">All formats</option><option value="Short">Short</option><option value="Long-form">Long-form</option><option value="Livestream">Livestream</option><option value="Music">Music</option><option value="Unknown">Unknown</option></select><select id="cf-video-page-size" class="input-field px-4 py-3 rounded-lg"><option value="10">10 per page</option><option value="25" selected>25 per page</option><option value="50">50 per page</option></select><div class="creatorflow-auth-actions"><button id="cf-video-prev" class="btn-outline px-3 py-2 rounded-lg">Prev</button><button id="cf-video-next" class="btn-outline px-3 py-2 rounded-lg">Next</button></div></div><div id="cf-video-page-label" class="creatorflow-muted mb-3"></div><div class="creatorflow-table-wrap"><table class="creatorflow-table"><thead><tr><th><button data-sort="rank">Rank</button></th><th><button data-sort="title">Title</button></th><th><button data-sort="views">Views</button></th><th><button data-sort="impressions">Impressions</button></th><th><button data-sort="ctr">CTR</button></th><th><button data-sort="watchTimeHours">Watch time</button></th><th>AVD</th><th><button data-sort="likes">Likes</button></th><th><button data-sort="comments">Comments</button></th><th><button data-sort="subscribersGained">Subscribers</button></th><th><button data-sort="publishedDate">Published</button></th><th>Duration</th><th>Pillar</th><th>Format</th><th><button data-sort="winner">Winner score</button></th></tr></thead><tbody id="cf-video-table"><tr><td colspan="15">${UNAVAILABLE}</td></tr></tbody></table></div></div></div></section>
        <section id="creatorflow-winners" class="section-content"><div class="creatorflow-shell"><div class="creatorflow-panel"><h1 class="text-3xl font-black text-white mb-4">Winners & 1K View Opportunity</h1><div id="cf-opportunities" class="space-y-3 creatorflow-muted">${UNAVAILABLE}</div></div></div></section>
        <section id="creatorflow-intelligence" class="section-content"><div class="creatorflow-shell"><div class="grid grid-cols-1 lg:grid-cols-2 gap-4"><div class="creatorflow-panel"><h2>Content Pillar Engine</h2><div id="cf-pillar-engine">${UNAVAILABLE}</div></div><div class="creatorflow-panel"><h2>Shorts vs Long-form</h2><div id="cf-format-engine">${UNAVAILABLE}</div></div><div class="creatorflow-panel lg:col-span-2"><h2>Video Comparison</h2><div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3"><select id="cf-compare-a" class="input-field px-3 py-2 rounded-lg"></select><select id="cf-compare-b" class="input-field px-3 py-2 rounded-lg"></select><button id="cf-compare-run" class="btn-primary px-3 py-2 rounded-lg">Compare Videos</button></div><div id="cf-video-comparison">${UNAVAILABLE}</div></div><div class="creatorflow-panel lg:col-span-2"><h2>Title Intelligence</h2><div id="cf-title-patterns">${UNAVAILABLE}</div></div></div></div></section>
        <section id="creatorflow-thumbnail-studio" class="section-content"><div class="creatorflow-shell"><div class="creatorflow-panel"><h1 class="text-3xl font-black text-white mb-2">Thumbnail Studio</h1><p class="creatorflow-muted mb-4">Real 1280x720 editor: upload, edit, save, reload, export PNG/JPEG.</p><div class="thumbnail-studio-layout"><div class="creatorflow-form"><label>Project name<input id="thumb-project-name" value="Variant project"></label><label>Upload image / logo<input id="thumb-image-upload" type="file" accept="image/*"></label><button class="btn-primary py-3 rounded-lg" id="thumb-add-text">Add Text</button><button class="btn-outline py-3 rounded-lg" id="thumb-add-shape">Add Shape</button><button class="btn-outline py-3 rounded-lg" id="thumb-toggle-guides">Safe-Area Guides</button><button class="btn-outline py-3 rounded-lg" id="thumb-save">Save Project</button><button class="btn-outline py-3 rounded-lg" id="thumb-export-png">Export PNG</button><button class="btn-outline py-3 rounded-lg" id="thumb-export-jpeg">Export JPEG</button></div><div><div class="thumbnail-canvas-stage"><canvas id="thumb-canvas" width="1280" height="720"></canvas></div><div class="creatorflow-panel mt-3"><h3>Preview</h3><div class="grid grid-cols-2 gap-3"><div><p class="creatorflow-muted mb-2">Desktop</p><img id="thumb-preview-desktop" alt="Desktop thumbnail preview" style="width:100%;border-radius:8px;background:#050505"></div><div><p class="creatorflow-muted mb-2">Mobile</p><img id="thumb-preview-mobile" alt="Mobile thumbnail preview" style="width:120px;border-radius:8px;background:#050505"></div></div></div></div><div class="creatorflow-form"><label>Variant<select id="thumb-variant"><option value="variant-a">Variant A</option><option value="variant-b">Variant B</option><option value="variant-c">Variant C</option></select></label><label>Font size<input id="thumb-font-size" type="number" value="72"></label><label>Font family<select id="thumb-font-family"><option>Impact</option><option>Inter</option><option>Arial</option><option>Georgia</option></select></label><label>Text color<input id="thumb-text-color" type="color" value="#ffffff"></label><label>Stroke color<input id="thumb-stroke-color" type="color" value="#000000"></label><label>Opacity<input id="thumb-opacity" type="range" min="0" max="1" step="0.05" value="1"></label><label>Letter spacing<input id="thumb-char-spacing" type="number" value="0"></label><label>Line spacing<input id="thumb-line-height" type="number" min="0.5" max="3" step="0.1" value="1.05"></label><div class="creatorflow-auth-actions"><button class="btn-outline px-3 py-2 rounded-lg" id="thumb-bold">Bold</button><button class="btn-outline px-3 py-2 rounded-lg" id="thumb-italic">Italic</button><button class="btn-outline px-3 py-2 rounded-lg" id="thumb-align">Align</button><button class="btn-outline px-3 py-2 rounded-lg" id="thumb-shadow">Shadow</button><button class="btn-outline px-3 py-2 rounded-lg" id="thumb-duplicate">Duplicate</button><button class="btn-outline px-3 py-2 rounded-lg" id="thumb-forward">Forward</button><button class="btn-outline px-3 py-2 rounded-lg" id="thumb-backward">Backward</button><button class="btn-outline px-3 py-2 rounded-lg" id="thumb-undo">Undo</button><button class="btn-outline px-3 py-2 rounded-lg" id="thumb-redo">Redo</button><button class="btn-outline px-3 py-2 rounded-lg" id="thumb-delete">Delete</button></div><h3>Layers</h3><div id="thumb-layers" class="creatorflow-layer-list"></div></div></div></div></div></section>
        <section id="creatorflow-thumbnail-lab" class="section-content"><div class="creatorflow-shell"><div class="creatorflow-panel"><h1 class="text-3xl font-black text-white mb-4">Thumbnail Lab</h1><div id="cf-thumbnail-projects">${UNAVAILABLE}</div></div></div></section>
        <section id="creatorflow-title-lab" class="section-content"><div class="creatorflow-shell"><div class="creatorflow-panel"><h1 class="text-3xl font-black text-white mb-4">Title Lab</h1><div id="cf-title-lab">${UNAVAILABLE}</div></div></div></section>
        <section id="creatorflow-reports" class="section-content"><div class="creatorflow-shell"><div class="creatorflow-panel"><h1 class="text-3xl font-black text-white mb-4">Reports</h1><div class="creatorflow-auth-actions"><button id="cf-report-json" class="btn-primary px-4 py-3 rounded-lg">Download JSON Report</button><button id="cf-report-csv" class="btn-outline px-4 py-3 rounded-lg">Download CSV Report</button></div><p class="creatorflow-muted mt-4">Reports use stored channel data only.</p></div></div></section>
        <section id="creatorflow-youtube" class="section-content"><div class="creatorflow-shell"><div class="grid grid-cols-1 lg:grid-cols-2 gap-4"><div class="creatorflow-panel"><h1 class="text-3xl font-black text-white mb-4">Channel Workspace</h1><form id="cf-channel-form" class="creatorflow-form"><label>Channel name<input name="name" required value="SpiritFlow Sounds"></label><label>YouTube channel URL<input name="youtubeUrl"></label><label>Channel ID if known<input name="youtubeChannelId"></label><label>Niche<input name="niche" value="Christian music and Bible storytelling"></label><label>Secondary niche<input name="secondaryNiche"></label><label>Target audience<textarea name="targetAudience"></textarea></label><label>Shorts threshold in seconds<input name="shortsThresholdSeconds" type="number" min="15" max="300" value="60"></label><button class="btn-primary py-3 rounded-lg">Save Channel Workspace</button></form></div><div class="creatorflow-panel"><h2>YouTube Connection</h2><p class="creatorflow-muted mb-4">OAuth uses YouTube Data API and Analytics API when configured. API data is labeled separately from CSV imports.</p><button onclick="connectYouTube()" class="btn-primary px-4 py-3 rounded-lg">Connect YouTube Channel</button><div id="cf-youtube-status" class="creatorflow-alert mt-4">${UNAVAILABLE}</div><h2 class="mt-6">Upload YouTube Analytics CSV</h2><input id="cf-csv-upload" type="file" accept=".csv,text/csv" class="input-field w-full px-4 py-3 rounded-lg mt-2"><div id="cf-csv-mapping" class="mt-4 creatorflow-muted"></div><div id="cf-data-quality" class="mt-4 creatorflow-muted"></div><button id="cf-import-csv" class="btn-outline px-4 py-3 rounded-lg mt-4">Import Detected Rows</button></div></div></div></section>
        <section id="creatorflow-settings" class="section-content"><div class="creatorflow-shell"><div class="creatorflow-panel"><h1 class="text-3xl font-black text-white mb-4">Settings</h1><div id="cf-settings">${UNAVAILABLE}</div><button id="cf-logout" class="btn-outline px-4 py-3 rounded-lg mt-4">Sign Out</button></div></div></section>`;
    }

    function authHtml() {
        return `<div class="creatorflow-auth" id="cf-auth-modal"><div class="creatorflow-auth-card"><h2>CreatorFlow Account</h2><p class="creatorflow-muted mt-2 mb-4">Create an account or sign in. All channels, imports, thumbnails, and reports are scoped to your account.</p><form id="cf-auth-form" class="creatorflow-form"><label>Name<input name="name" value="Creator"></label><label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" minlength="8" required></label><label>Initial channel<input name="channelName" value="SpiritFlow Sounds"></label><div class="creatorflow-auth-actions"><button class="btn-primary px-4 py-3 rounded-lg" data-mode="signup">Create Account</button><button class="btn-outline px-4 py-3 rounded-lg" data-mode="login">Sign In</button><button type="button" class="btn-outline px-4 py-3 rounded-lg" data-cf-close-auth>Close</button></div><div id="cf-auth-error" class="creatorflow-alert creatorflow-danger hidden"></div></form></div></div>`;
    }

    function bindEvents() {
        document.querySelectorAll('[data-cf-open-auth]').forEach(button => button.addEventListener('click', () => $('cf-auth-modal').classList.add('active')));
        document.querySelectorAll('[data-cf-close-auth]').forEach(button => button.addEventListener('click', () => $('cf-auth-modal').classList.remove('active')));
        $('cf-auth-form')?.addEventListener('submit', handleAuth);
        $('cf-channel-form')?.addEventListener('submit', saveChannel);
        $('cf-csv-upload')?.addEventListener('change', readCsv);
        $('cf-import-csv')?.addEventListener('click', importCsv);
        $('cf-video-search')?.addEventListener('input', () => { state.page = 1; renderVideos(); });
        $('cf-video-format')?.addEventListener('change', event => { state.formatFilter = event.target.value; state.page = 1; renderVideos(); });
        $('cf-video-page-size')?.addEventListener('change', event => { state.pageSize = Number(event.target.value || 25); state.page = 1; renderVideos(); });
        $('cf-video-prev')?.addEventListener('click', () => { state.page = Math.max(1, state.page - 1); renderVideos(); });
        $('cf-video-next')?.addEventListener('click', () => { state.page += 1; renderVideos(); });
        document.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
            const key = button.dataset.sort;
            state.sortDir = state.sortKey === key && state.sortDir === 'desc' ? 'asc' : 'desc';
            state.sortKey = key;
            renderVideos();
        }));
        $('cf-compare-run')?.addEventListener('click', renderComparison);
        $('cf-report-json')?.addEventListener('click', () => downloadReport('json'));
        $('cf-report-csv')?.addEventListener('click', () => downloadReport('csv'));
        $('cf-logout')?.addEventListener('click', logout);
        document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
            state.dateRange = button.dataset.range;
            refresh();
        }));
        $('cf-custom-range')?.addEventListener('click', () => {
            state.dateRange = 'custom';
            state.customStartDate = $('cf-custom-start')?.value || '';
            state.customEndDate = $('cf-custom-end')?.value || '';
            refresh();
        });
        bindThumbnailStudio();
    }

    async function handleAuth(event) {
        event.preventDefault();
        const button = event.submitter;
        const mode = button?.dataset.mode || 'login';
        const form = new FormData(event.currentTarget);
        try {
            const data = await api(mode, { method: 'POST', body: Object.fromEntries(form.entries()) });
            state.user = data.user;
            $('cf-auth-modal').classList.remove('active');
            toast('Signed in to CreatorFlow.');
            await refresh();
        } catch (error) {
            const box = $('cf-auth-error');
            box.textContent = error.message;
            box.classList.remove('hidden');
        }
    }

    async function logout() {
        await api('logout').catch(() => null);
        state.user = null;
        toast('Signed out.');
        location.reload();
    }

    async function saveChannel(event) {
        event.preventDefault();
        const body = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
            await api('channels', { method: 'POST', body });
            toast('Channel workspace saved.');
            await refresh();
        } catch (error) {
            toast(error.message);
        }
    }

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let cell = '';
        let quoted = false;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const next = text[i + 1];
            if (char === '"' && quoted && next === '"') {
                cell += '"';
                i++;
            } else if (char === '"') {
                quoted = !quoted;
            } else if (char === ',' && !quoted) {
                row.push(cell);
                cell = '';
            } else if ((char === '\n' || char === '\r') && !quoted) {
                if (char === '\r' && next === '\n') i++;
                row.push(cell);
                if (row.some(value => value.trim())) rows.push(row);
                row = [];
                cell = '';
            } else {
                cell += char;
            }
        }
        row.push(cell);
        if (row.some(value => value.trim())) rows.push(row);
        const headers = rows.shift() || [];
        return { headers, rows: rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || '']))) };
    }

    function detectMapping(headers) {
        const aliases = {
            title: ['video title', 'title', 'content', 'video'],
            views: ['views', 'view', 'video views'],
            impressions: ['impressions'],
            ctr: ['impressions click through rate', 'impressions ctr', 'ctr', 'click through rate'],
            watchTimeHours: ['watch time hours', 'watch time', 'watch hours'],
            averageViewDuration: ['average view duration', 'average duration', 'avd'],
            likes: ['likes'],
            comments: ['comments'],
            subscribersGained: ['subscribers gained', 'subs gained'],
            date: ['date', 'published date'],
            duration: ['video duration', 'duration'],
            trafficSource: ['traffic source', 'source'],
            contentType: ['content type', 'format', 'type']
        };
        const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const normalized = headers.map(normalize);
        return Object.fromEntries(Object.entries(aliases).map(([field, options]) => {
            const index = normalized.findIndex(header => options.some(option => header === option || header.includes(option)));
            return [field, index >= 0 ? headers[index] : null];
        }));
    }

    async function readCsv(event) {
        const file = event.target.files[0];
        if (!file) return;
        const text = await file.text();
        const parsed = parseCsv(text);
        parsed.fileName = file.name;
        parsed.mapping = detectMapping(parsed.headers);
        state.pendingCsv = parsed;
        $('cf-csv-mapping').innerHTML = `<div class="creatorflow-alert">Detected ${parsed.rows.length} rows.</div><div class="creatorflow-table-wrap mt-3"><table class="creatorflow-table"><thead><tr><th>Metric</th><th>Detected column</th></tr></thead><tbody>${Object.entries(parsed.mapping).map(([field, column]) => `<tr><td>${field}</td><td>${column ? escapeHtml(column) : 'Not available in this export.'}</td></tr>`).join('')}</tbody></table></div>`;
    }

    async function importCsv() {
        if (!state.pendingCsv) return toast('Choose a CSV first.');
        if (!state.channel) return toast('Create or select a channel workspace first.');
        try {
            const mapping = Object.fromEntries(Object.entries(state.pendingCsv.mapping).filter(([, column]) => column));
            const data = await api('import-analytics', { method: 'POST', body: { channelId: state.channel.id, fileName: state.pendingCsv.fileName, headers: state.pendingCsv.headers, rows: state.pendingCsv.rows, mapping } });
            toast(`Imported ${data.importedVideos} real analytics rows.`);
            renderQuality(data.quality);
            await refresh();
        } catch (error) {
            toast(error.message);
        }
    }

    async function refresh() {
        try {
            const me = await api('me');
            state.user = me.user;
        } catch (error) {
            renderUnavailable(error.message);
            return;
        }
        if (!state.user) {
            renderUnavailable('Sign in or create an account to begin.');
            return;
        }
        try {
            let query = `&range=${encodeURIComponent(state.dateRange)}`;
            if (state.dateRange === 'custom') query += `&startDate=${encodeURIComponent(state.customStartDate)}&endDate=${encodeURIComponent(state.customEndDate)}`;
            const data = await api('analytics', { query });
            state.channels = data.channels || [];
            state.channel = data.channel || state.channels[0] || null;
            state.analytics = data.analytics;
            renderAll();
        } catch (error) {
            renderUnavailable(error.message);
        }
    }

    function renderUnavailable(message = UNAVAILABLE) {
        if ($('cf-unavailable')) $('cf-unavailable').textContent = message;
        ['cf-health-metrics', 'cf-next-moves', 'cf-winner-list', 'cf-pillar-list', 'cf-opportunities', 'cf-pillar-engine', 'cf-format-engine', 'cf-title-patterns'].forEach(id => {
            if ($(id)) $(id).innerHTML = `<div class="creatorflow-alert">${escapeHtml(message)}</div>`;
        });
    }

    function renderAll() {
        const videos = state.analytics?.videos || [];
        const totals = state.analytics?.totals || {};
        const hasData = videos.length > 0;
        if ($('cf-unavailable')) $('cf-unavailable').textContent = hasData ? `Using ${videos.length} stored real video records for ${state.channel?.name || 'this channel'}.` : UNAVAILABLE;
        $('cf-health-metrics').innerHTML = [
            ['Subscribers', 'Not available in CSV'],
            ['Views', number(totals.views)],
            ['Watch Time', `${number(Math.round(totals.watchTimeHours || 0))}h`],
            ['CTR', percent(totals.averageCtr)],
            ['Uploads', number(totals.videos)],
            ['Videos >=100', number(totals.over100)],
            ['Videos >=500', number(totals.over500)],
            ['Videos >=1K', number(totals.over1000)],
            ['Videos >=5K', number(totals.over5000)],
            ['Zero-view videos', number(totals.zeroViews)]
        ].map(([label, value]) => `<div class="creatorflow-panel creatorflow-metric"><span class="creatorflow-muted">${label}</span><strong>${value}</strong></div>`).join('');
        renderVideos();
        renderWinners();
        renderIntelligence();
        renderCompareOptions();
        renderCharts();
        renderExistingAnalytics();
    }

    function renderVideos() {
        const term = ($('cf-video-search')?.value || '').toLowerCase();
        const format = state.formatFilter || 'all';
        const videos = (state.analytics?.videos || [])
            .filter(video => video.title.toLowerCase().includes(term))
            .filter(video => format === 'all' || video.format === format)
            .sort((a, b) => {
                const key = state.sortKey;
                const valueA = key === 'winner' ? a.winner?.total : key === 'rank' ? state.analytics.videos.indexOf(a) : a[key];
                const valueB = key === 'winner' ? b.winner?.total : key === 'rank' ? state.analytics.videos.indexOf(b) : b[key];
                const numericA = Number(valueA);
                const numericB = Number(valueB);
                const result = Number.isFinite(numericA) && Number.isFinite(numericB)
                    ? numericA - numericB
                    : String(valueA || '').localeCompare(String(valueB || ''));
                return state.sortDir === 'asc' ? result : -result;
            });
        const pageCount = Math.max(1, Math.ceil(videos.length / state.pageSize));
        state.page = Math.min(state.page, pageCount);
        const start = (state.page - 1) * state.pageSize;
        const pageRows = videos.slice(start, start + state.pageSize);
        if ($('cf-video-page-label')) $('cf-video-page-label').textContent = videos.length ? `Page ${state.page} of ${pageCount}. Showing ${start + 1}-${start + pageRows.length} of ${videos.length} videos.` : '';
        $('cf-video-table').innerHTML = pageRows.length ? pageRows.map((video, index) => `<tr><td>${start + index + 1}</td><td>${escapeHtml(video.title)}</td><td>${number(video.views)}</td><td>${video.impressions == null ? 'Not available' : number(video.impressions)}</td><td>${percent(video.ctr)}</td><td>${video.watchTimeHours == null ? 'Not available' : `${number(video.watchTimeHours)}h`}</td><td>${escapeHtml(video.averageViewDuration || 'Not available')}</td><td>${video.likes == null ? 'Not available' : number(video.likes)}</td><td>${video.comments == null ? 'Not available' : number(video.comments)}</td><td>${video.subscribersGained == null ? 'Not available' : number(video.subscribersGained)}</td><td>${escapeHtml(video.publishedDate || 'Not available')}</td><td>${escapeHtml(video.duration || 'Not available')}</td><td>${escapeHtml(video.contentPillar)}</td><td>${escapeHtml(video.format)}</td><td>${video.winner.total}/100 ${video.winner.label}</td></tr>`).join('') : `<tr><td colspan="15">${UNAVAILABLE}</td></tr>`;
    }

    function renderQuality(quality) {
        const box = $('cf-data-quality');
        if (!box || !quality) return;
        const groups = [
            ['Missing columns', quality.missingColumns?.map(item => `${item.field}: ${item.message}`)],
            ['Missing values', quality.missingValues?.map(item => `Row ${item.row}: ${item.field}`)],
            ['Invalid numbers', quality.invalidNumbers?.map(item => `Row ${item.row}: ${item.field} = ${item.value}`)],
            ['Invalid dates', quality.invalidDates?.map(item => `Row ${item.row}: ${item.value}`)],
            ['Malformed percentages', quality.malformedPercentages?.map(item => `Row ${item.row}: ${item.value}`)],
            ['Duplicate records', quality.duplicateRecords?.map(item => `${item.key} (${item.count})`)]
        ];
        box.innerHTML = `<div class="creatorflow-alert"><strong>Data quality report</strong><br>${quality.rowCount} rows inspected. Original raw rows and cleaned video IDs were stored with this import.</div>` +
            groups.map(([title, items]) => `<div class="creatorflow-panel mt-3"><h3>${title}</h3><p class="creatorflow-muted">${items?.length ? items.slice(0, 8).map(escapeHtml).join('<br>') : 'No issues detected.'}</p></div>`).join('');
    }

    function renderWinners() {
        const videos = state.analytics?.videos || [];
        const winners = videos.filter(video => video.winner.total >= 50).slice(0, 10);
        $('cf-winner-list').innerHTML = winners.length ? winners.map(video => `<div class="creatorflow-alert"><strong>${escapeHtml(video.winner.label)}</strong><br>${escapeHtml(video.title)} - ${number(video.views)} views - score ${video.winner.total}/100</div>`).join('') : UNAVAILABLE;
        const close = videos.filter(video => Number(video.views || 0) >= 700 && Number(video.views || 0) < 1000).slice(0, 8);
        const exceeded = videos.filter(video => Number(video.views || 0) >= 1000).slice(0, 8);
        $('cf-opportunities').innerHTML = videos.length ? [
            ...close.map(video => opportunityCard('Close to 1K', video, 'Create a sequel or Part 2 using the same topic structure.')),
            ...exceeded.map(video => opportunityCard('Repeatable 1K Winner', video, 'Repeat the topic with a new hook, format bridge, or playlist continuation.'))
        ].join('') || '<div class="creatorflow-alert">No 1K opportunities detected yet from the imported data.</div>' : UNAVAILABLE;
        $('cf-next-moves').innerHTML = winners.length ? winners.slice(0, 5).map(video => `<div class="creatorflow-alert">Repeat evidence from "${escapeHtml(video.title)}" because it outperformed the channel median.</div>`).join('') : UNAVAILABLE;
    }

    function opportunityCard(label, video, action) {
        return `<div class="creatorflow-panel"><h3>${label}</h3><p>${escapeHtml(video.title)}</p><p class="creatorflow-muted">Evidence: ${number(video.views)} views, ${percent(video.ctr)} CTR, ${escapeHtml(video.contentPillar)}.</p><p class="text-lemon mt-2">Recommended next action: ${action}</p></div>`;
    }

    function renderIntelligence() {
        const videos = state.analytics?.videos || [];
        const pillars = state.analytics?.pillarPerformance || [];
        $('cf-pillar-list').innerHTML = pillars.length ? pillars.slice(0, 5).map(p => `<div>${escapeHtml(p.pillar)}: ${number(p.views)} views, ${number(Math.round(p.averageViews))} avg views, ${(p.oneKRate * 100).toFixed(0)}% 1K+ rate</div>`).join('') : UNAVAILABLE;
        $('cf-pillar-engine').innerHTML = pillars.length ? `<div class="creatorflow-table-wrap"><table class="creatorflow-table"><thead><tr><th>Pillar</th><th>Videos</th><th>Views</th><th>Avg views</th><th>CTR</th><th>1K+ rate</th></tr></thead><tbody>${pillars.map(p => `<tr><td>${escapeHtml(p.pillar)}</td><td>${p.videos}</td><td>${number(p.views)}</td><td>${number(Math.round(p.averageViews))}</td><td>${percent(p.averageCtr)}</td><td>${(p.oneKRate * 100).toFixed(0)}%</td></tr>`).join('')}</tbody></table></div>` : UNAVAILABLE;
        const formats = {};
        videos.forEach(video => {
            const key = video.format || 'Unknown';
            formats[key] ||= { videos: 0, views: 0, watchTimeHours: 0, ctr: [] };
            formats[key].videos++;
            formats[key].views += Number(video.views || 0);
            formats[key].watchTimeHours += Number(video.watchTimeHours || 0);
            if (video.ctr != null) formats[key].ctr.push(Number(video.ctr));
        });
        $('cf-format-engine').innerHTML = videos.length ? Object.entries(formats).map(([format, row]) => `<div class="creatorflow-alert"><strong>${format}</strong>: ${row.videos} videos, ${number(row.views)} views, ${number(Math.round(row.views / row.videos))} average views. Strategy interpretation: ${format === 'Short' ? 'discovery' : format === 'Long-form' ? 'deeper engagement' : format === 'Livestream' ? 'watch time/community' : format === 'Music' ? 'brand/worship destination' : 'needs more metadata'}.</div>`).join('') : UNAVAILABLE;
        renderTitlePatterns(videos);
    }

    function renderCompareOptions() {
        const videos = state.analytics?.videos || [];
        const options = videos.map(video => `<option value="${video.id}">${escapeHtml(video.title)}</option>`).join('');
        if ($('cf-compare-a')) $('cf-compare-a').innerHTML = options;
        if ($('cf-compare-b')) $('cf-compare-b').innerHTML = options;
        if ($('cf-compare-b') && videos[1]) $('cf-compare-b').value = videos[1].id;
        if (videos.length >= 2) renderComparison();
    }

    function renderComparison() {
        const videos = state.analytics?.videos || [];
        const a = videos.find(video => video.id === $('cf-compare-a')?.value);
        const b = videos.find(video => video.id === $('cf-compare-b')?.value);
        const box = $('cf-video-comparison');
        if (!box) return;
        if (!a || !b) {
            box.innerHTML = `<div class="creatorflow-alert">${UNAVAILABLE}</div>`;
            return;
        }
        const metrics = [
            ['Views', a.views, b.views],
            ['CTR', a.ctr, b.ctr, true],
            ['Impressions', a.impressions, b.impressions],
            ['Watch time', a.watchTimeHours, b.watchTimeHours],
            ['Average view duration', a.averageViewDuration, b.averageViewDuration],
            ['Likes', a.likes, b.likes],
            ['Comments', a.comments, b.comments],
            ['Subscribers', a.subscribersGained, b.subscribersGained],
            ['Title length', a.title.length, b.title.length],
            ['Pillar', a.contentPillar, b.contentPillar],
            ['Format', a.format, b.format],
            ['Published', a.publishedDate, b.publishedDate]
        ];
        const observations = [];
        if (Number(a.views || 0) !== Number(b.views || 0)) {
            const winner = Number(a.views || 0) > Number(b.views || 0) ? 'Video A' : 'Video B';
            observations.push(`${winner} has more observed views in the stored dataset.`);
        }
        if (a.ctr != null && b.ctr != null && Number(a.ctr) !== Number(b.ctr)) {
            const winner = Number(a.ctr) > Number(b.ctr) ? 'Video A' : 'Video B';
            observations.push(`${winner} has stronger observed CTR, but CTR alone does not explain total performance.`);
        }
        if (a.contentPillar !== b.contentPillar) observations.push('The videos belong to different content pillars, so compare them as directional evidence, not proof of causation.');
        box.innerHTML = `<div class="creatorflow-table-wrap"><table class="creatorflow-table"><thead><tr><th>Metric</th><th>Video A</th><th>Video B</th></tr></thead><tbody>${metrics.map(([label, va, vb, isPct]) => `<tr><td>${label}</td><td>${isPct ? percent(va) : escapeHtml(va == null || va === '' ? 'Not available' : numberOrText(va))}</td><td>${isPct ? percent(vb) : escapeHtml(vb == null || vb === '' ? 'Not available' : numberOrText(vb))}</td></tr>`).join('')}</tbody></table></div><div class="creatorflow-alert mt-3"><strong>Evidence-based observations</strong><br>${observations.length ? observations.map(escapeHtml).join('<br>') : 'No clear differences can be stated from available metrics.'}</div>`;
    }

    function numberOrText(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && String(value).trim() !== '' ? number(parsed) : value;
    }

    function renderTitlePatterns(videos) {
        const patterns = ['God', 'Then', 'This Happened', 'Almost', 'All Hope', 'Wanted', 'Dead', 'Saw', 'Answered', '?', '!'];
        const rows = patterns.map(pattern => {
            const matches = videos.filter(video => video.title.toLowerCase().includes(pattern.toLowerCase()));
            if (!matches.length) return null;
            const views = matches.map(video => Number(video.views || 0)).sort((a, b) => a - b);
            return { pattern, count: matches.length, average: views.reduce((a, b) => a + b, 0) / views.length, median: views[Math.floor(views.length / 2)], best: matches.sort((a, b) => b.views - a.views)[0], oneK: matches.filter(video => video.views >= 1000).length / matches.length };
        }).filter(Boolean);
        $('cf-title-patterns').innerHTML = rows.length ? `<div class="creatorflow-table-wrap"><table class="creatorflow-table"><thead><tr><th>Title Pattern</th><th>Videos</th><th>Average Views</th><th>Median Views</th><th>Best Video</th><th>1K+ Rate</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.pattern)}</td><td>${row.count}</td><td>${number(Math.round(row.average))}</td><td>${number(Math.round(row.median))}</td><td>${escapeHtml(row.best.title)}</td><td>${(row.oneK * 100).toFixed(0)}%</td></tr>`).join('')}</tbody></table></div>` : UNAVAILABLE;
        $('cf-title-lab').innerHTML = $('cf-title-patterns').innerHTML;
    }

    function renderCharts() {
        const canvas = $('cf-views-chart');
        if (!canvas || !window.Chart) return;
        if (canvas.chart) canvas.chart.destroy();
        const videos = (state.analytics?.videos || []).slice().reverse();
        canvas.chart = new Chart(canvas, {
            type: 'line',
            data: { labels: videos.map(video => (video.publishedDate || video.title).slice(0, 16)), datasets: [{ data: videos.map(video => Number(video.views || 0)), borderColor: '#c8ff00', backgroundColor: 'rgba(200,255,0,.12)', fill: true, tension: .35 }] },
            options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#888' } }, y: { ticks: { color: '#888' } } } }
        });
    }

    function renderExistingAnalytics() {
        const totals = state.analytics?.totals || {};
        if (!state.analytics?.videos?.length) return;
        window.youtubeChannelData = {
            channel: { title: state.channel?.name, statistics: { subscriberCount: 'Not available', viewCount: totals.views, videoCount: totals.videos }, compact: { subscribers: 'N/A', views: number(totals.views), videos: number(totals.videos) } },
            analytics: { minutesWatched: Number(totals.watchTimeHours || 0) * 60, rows: [] },
            audit: { health: 0, strengths: [], weaknesses: [], recommendations: [] },
            videos: state.analytics.videos.slice(0, 10).map(video => ({ title: video.title, compact: { views: number(video.views), likes: video.likes == null ? 'N/A' : number(video.likes), comments: video.comments == null ? 'N/A' : number(video.comments) } }))
        };
        if (window.renderYouTubeChannel) window.renderYouTubeChannel(window.youtubeChannelData);
    }

    function bindThumbnailStudio() {
        $('thumb-add-text')?.addEventListener('click', addText);
        $('thumb-add-shape')?.addEventListener('click', addShape);
        $('thumb-image-upload')?.addEventListener('change', uploadThumbImage);
        $('thumb-save')?.addEventListener('click', saveThumbnailProject);
        $('thumb-export-png')?.addEventListener('click', () => exportThumbnail('png'));
        $('thumb-export-jpeg')?.addEventListener('click', () => exportThumbnail('jpeg'));
        $('thumb-delete')?.addEventListener('click', deleteLayer);
        $('thumb-duplicate')?.addEventListener('click', duplicateLayer);
        $('thumb-forward')?.addEventListener('click', bringForward);
        $('thumb-backward')?.addEventListener('click', sendBackward);
        $('thumb-toggle-guides')?.addEventListener('click', toggleGuides);
        $('thumb-bold')?.addEventListener('click', toggleBold);
        $('thumb-italic')?.addEventListener('click', toggleItalic);
        $('thumb-align')?.addEventListener('click', cycleAlign);
        $('thumb-shadow')?.addEventListener('click', toggleShadow);
        $('thumb-undo')?.addEventListener('click', undo);
        $('thumb-redo')?.addEventListener('click', redo);
        $('thumb-variant')?.addEventListener('change', loadVariant);
        ['thumb-font-size', 'thumb-font-family', 'thumb-text-color', 'thumb-stroke-color', 'thumb-opacity', 'thumb-char-spacing', 'thumb-line-height'].forEach(id => $(id)?.addEventListener('input', updateSelected));
    }

    function initThumbnailStudio() {
        if (state.fabricCanvas || !window.fabric || !$('thumb-canvas')) return;
        state.fabricCanvas = new fabric.Canvas('thumb-canvas', { backgroundColor: '#111111', preserveObjectStacking: true });
        state.fabricCanvas.on('object:modified', snapshot);
        state.fabricCanvas.on('object:added', snapshot);
        state.fabricCanvas.on('object:scaling', updatePreview);
        state.fabricCanvas.on('object:moving', updatePreview);
        state.fabricCanvas.on('selection:created', renderLayers);
        state.fabricCanvas.on('selection:updated', renderLayers);
        state.fabricCanvas.on('selection:cleared', renderLayers);
        snapshot();
        loadThumbnailProjects();
    }

    function snapshot() {
        if (!state.fabricCanvas || state.loadingHistory) return;
        state.history.push(JSON.stringify(state.fabricCanvas.toJSON()));
        if (state.history.length > 40) state.history.shift();
        state.redo = [];
        renderLayers();
        updatePreview();
    }

    function addText() {
        initThumbnailStudio();
        const text = new fabric.IText('THUMBNAIL TEXT', { left: 120, top: 120, fill: $('thumb-text-color').value, stroke: $('thumb-stroke-color').value, strokeWidth: 3, fontSize: Number($('thumb-font-size').value || 72), fontWeight: 'bold' });
        state.fabricCanvas.add(text).setActiveObject(text);
    }

    function addShape() {
        initThumbnailStudio();
        const rect = new fabric.Rect({ left: 180, top: 180, width: 360, height: 160, fill: 'rgba(200,255,0,0.8)', rx: 4, ry: 4 });
        state.fabricCanvas.add(rect).setActiveObject(rect);
    }

    function uploadThumbImage(event) {
        initThumbnailStudio();
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => fabric.Image.fromURL(reader.result, img => {
            img.scaleToWidth(640);
            img.set({ left: 80, top: 80 });
            state.fabricCanvas.add(img).setActiveObject(img);
        });
        reader.readAsDataURL(file);
    }

    function updateSelected() {
        const obj = state.fabricCanvas?.getActiveObject();
        if (!obj) return;
        if ('fontSize' in obj) obj.set({
            fontSize: Number($('thumb-font-size').value || 72),
            fontFamily: $('thumb-font-family')?.value || 'Impact',
            fill: $('thumb-text-color').value,
            stroke: $('thumb-stroke-color').value,
            charSpacing: Number($('thumb-char-spacing')?.value || 0),
            lineHeight: Number($('thumb-line-height')?.value || 1.05)
        });
        obj.set({ opacity: Number($('thumb-opacity').value || 1) });
        state.fabricCanvas.requestRenderAll();
        snapshot();
    }

    function renderLayers() {
        const list = $('thumb-layers');
        if (!list || !state.fabricCanvas) return;
        list.innerHTML = state.fabricCanvas.getObjects().map((obj, index) => `<button data-layer="${index}">${index + 1}. ${obj.type}${obj.text ? ` - ${escapeHtml(obj.text.slice(0, 18))}` : ''}</button>`).reverse().join('');
        list.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
            state.fabricCanvas.setActiveObject(state.fabricCanvas.getObjects()[Number(button.dataset.layer)]);
            state.fabricCanvas.requestRenderAll();
        }));
    }

    function deleteLayer() {
        const obj = state.fabricCanvas?.getActiveObject();
        if (!obj) return;
        state.fabricCanvas.remove(obj);
        snapshot();
    }

    function duplicateLayer() {
        const obj = state.fabricCanvas?.getActiveObject();
        if (!obj) return;
        obj.clone(clone => {
            clone.set({ left: (obj.left || 0) + 30, top: (obj.top || 0) + 30 });
            state.fabricCanvas.add(clone).setActiveObject(clone);
            snapshot();
        });
    }

    function bringForward() {
        const obj = state.fabricCanvas?.getActiveObject();
        if (!obj) return;
        state.fabricCanvas.bringForward(obj);
        state.fabricCanvas.requestRenderAll();
        snapshot();
    }

    function sendBackward() {
        const obj = state.fabricCanvas?.getActiveObject();
        if (!obj) return;
        state.fabricCanvas.sendBackwards(obj);
        state.fabricCanvas.requestRenderAll();
        snapshot();
    }

    function toggleBold() {
        const obj = state.fabricCanvas?.getActiveObject();
        if (!obj || !('fontWeight' in obj)) return;
        obj.set('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold');
        state.fabricCanvas.requestRenderAll();
        snapshot();
    }

    function toggleItalic() {
        const obj = state.fabricCanvas?.getActiveObject();
        if (!obj || !('fontStyle' in obj)) return;
        obj.set('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic');
        state.fabricCanvas.requestRenderAll();
        snapshot();
    }

    function cycleAlign() {
        const obj = state.fabricCanvas?.getActiveObject();
        if (!obj || !('textAlign' in obj)) return;
        const order = ['left', 'center', 'right'];
        obj.set('textAlign', order[(order.indexOf(obj.textAlign) + 1) % order.length]);
        state.fabricCanvas.requestRenderAll();
        snapshot();
    }

    function toggleShadow() {
        const obj = state.fabricCanvas?.getActiveObject();
        if (!obj) return;
        obj.set('shadow', obj.shadow ? null : new fabric.Shadow({ color: 'rgba(0,0,0,0.75)', blur: 18, offsetX: 8, offsetY: 8 }));
        state.fabricCanvas.requestRenderAll();
        snapshot();
    }

    function toggleGuides() {
        initThumbnailStudio();
        const existing = state.fabricCanvas.getObjects().filter(obj => obj.creatorFlowGuide);
        if (existing.length) {
            existing.forEach(obj => state.fabricCanvas.remove(obj));
        } else {
            const guideStyle = { fill: 'transparent', stroke: 'rgba(200,255,0,0.6)', strokeDashArray: [12, 8], selectable: false, evented: false, creatorFlowGuide: true };
            state.fabricCanvas.add(new fabric.Rect({ left: 64, top: 36, width: 1152, height: 648, ...guideStyle }));
            state.fabricCanvas.add(new fabric.Rect({ left: 160, top: 90, width: 960, height: 540, stroke: 'rgba(255,255,255,0.35)', fill: 'transparent', strokeDashArray: [8, 8], selectable: false, evented: false, creatorFlowGuide: true }));
        }
        state.fabricCanvas.requestRenderAll();
        updatePreview();
    }

    function updatePreview() {
        if (!state.fabricCanvas) return;
        const dataUrl = state.fabricCanvas.toDataURL({ format: 'jpeg', quality: 0.75, multiplier: 0.25 });
        if ($('thumb-preview-desktop')) $('thumb-preview-desktop').src = dataUrl;
        if ($('thumb-preview-mobile')) $('thumb-preview-mobile').src = dataUrl;
    }

    function undo() {
        if (state.history.length < 2) return;
        state.redo.push(state.history.pop());
        loadCanvasJson(state.history[state.history.length - 1]);
    }

    function redo() {
        const json = state.redo.pop();
        if (!json) return;
        state.history.push(json);
        loadCanvasJson(json);
    }

    function loadCanvasJson(json) {
        state.loadingHistory = true;
        state.fabricCanvas.loadFromJSON(json, () => {
            state.loadingHistory = false;
            state.fabricCanvas.renderAll();
            renderLayers();
            updatePreview();
        });
    }

    async function saveThumbnailProject() {
        initThumbnailStudio();
        if (!state.channel) return toast('Create a channel workspace first.');
        const variantId = $('thumb-variant').value;
        const existing = state.thumbnailProject || { variants: [] };
        const variants = existing.variants.filter(variant => variant.id !== variantId);
        variants.push({ id: variantId, name: $('thumb-variant').selectedOptions[0].textContent, canvasJson: state.fabricCanvas.toJSON(), previewDataUrl: state.fabricCanvas.toDataURL({ format: 'jpeg', quality: 0.75, multiplier: 0.25 }), updatedAt: new Date().toISOString() });
        const data = await api('thumbnail-projects', { method: 'POST', body: { id: existing.id, channelId: state.channel.id, name: $('thumb-project-name').value, activeVariantId: variantId, variants } });
        state.thumbnailProject = data.project;
        toast('Thumbnail project saved.');
        renderThumbnailProjects();
    }

    async function loadThumbnailProjects() {
        try {
            const data = await api('thumbnail-projects', { query: state.channel ? `&channelId=${state.channel.id}` : '' });
            state.thumbnailProject = data.projects?.[0] || null;
            renderThumbnailProjects();
            if (state.thumbnailProject) loadVariant();
        } catch (error) {}
    }

    function loadVariant() {
        initThumbnailStudio();
        const variant = state.thumbnailProject?.variants?.find(item => item.id === $('thumb-variant').value);
        if (variant?.canvasJson) {
            state.fabricCanvas.loadFromJSON(variant.canvasJson, () => state.fabricCanvas.renderAll());
        } else {
            state.fabricCanvas.clear();
            state.fabricCanvas.backgroundColor = '#111111';
            state.fabricCanvas.renderAll();
        }
    }

    function renderThumbnailProjects() {
        const box = $('cf-thumbnail-projects');
        if (!box) return;
        const project = state.thumbnailProject;
        box.innerHTML = project ? `<div class="creatorflow-grid metrics">${project.variants.map(variant => `<div class="creatorflow-panel"><img src="${variant.previewDataUrl}" alt="${escapeHtml(variant.name)}" style="width:100%;border-radius:8px"><h3 class="mt-3">${escapeHtml(variant.name)}</h3><p class="creatorflow-muted">Saved ${escapeHtml(variant.updatedAt)}</p><p class="creatorflow-muted">Performance comparison appears only after real YouTube/CSV data is available.</p></div>`).join('')}</div>` : UNAVAILABLE;
    }

    function exportThumbnail(format) {
        initThumbnailStudio();
        const dataUrl = state.fabricCanvas.toDataURL({ format: format === 'jpeg' ? 'jpeg' : 'png', quality: 0.92, multiplier: 1 });
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${($('thumb-project-name').value || 'creatorflow-thumbnail').replace(/[^a-z0-9]+/gi, '-')}.${format === 'jpeg' ? 'jpg' : 'png'}`;
        a.click();
    }

    async function downloadReport(type) {
        try {
            const report = await api('report');
            const content = type === 'json' ? JSON.stringify(report, null, 2) : toCsv(report.analytics?.videos || []);
            const blob = new Blob([content], { type: type === 'json' ? 'application/json' : 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `creatorflow-report.${type}`;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (error) {
            toast(error.message);
        }
    }

    function toCsv(rows) {
        const headers = ['title', 'views', 'impressions', 'ctr', 'watchTimeHours', 'likes', 'comments', 'subscribersGained', 'publishedDate', 'duration', 'contentPillar', 'format', 'winnerScore'];
        return [headers.join(','), ...rows.map(row => headers.map(header => `"${String(header === 'winnerScore' ? row.winner?.total : row[header] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    }

    const oldShowSection = window.showSection;
    function creatorFlowNavigate(sectionId) {
        if (oldShowSection) oldShowSection(sectionId);
        if (!oldShowSection) {
            document.querySelectorAll('.section-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tool-interface').forEach(el => el.classList.remove('active'));
            document.getElementById(sectionId)?.classList.add('active');
            document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
            document.getElementById(`nav-${sectionId}`)?.classList.add('active');
            window.scrollTo(0, 0);
        }
        if (sectionId === 'creatorflow-thumbnail-studio') setTimeout(initThumbnailStudio, 50);
        if (sectionId?.startsWith('creatorflow')) setTimeout(refresh, 20);
    }
    window.CreatorFlowNavigate = creatorFlowNavigate;
    window.showSection = creatorFlowNavigate;

    window.callFreeAI = async function (prompt, isChat = false) {
        try {
            const data = await api('ai', { method: 'POST', body: { prompt, isChat } });
            return data.text;
        } catch (error) {
            return isChat ? 'Connect YouTube or upload analytics data so I can analyze your channel. AI also requires OPENAI_API_KEY or OPENROUTER_API_KEY on the server.' : JSON.stringify({ unavailable: true, error: error.message });
        }
    };

    window.generateRealTitles = async function () {
        toast('Title Lab uses real channel history after CSV import or YouTube connection.');
        return [];
    };

    window.generateContentIdeas = function () {
        const videos = state.analytics?.videos || [];
        const box = $('content-ideas-list');
        if (!videos.length) {
            toast(UNAVAILABLE);
            if (box) box.innerHTML = `<div class="creatorflow-alert">${UNAVAILABLE}</div>`;
            $('content-results')?.classList.remove('hidden');
            return;
        }
        const ideas = videos.slice(0, 20).map(video => ({
            title: `${video.title} - Part 2`,
            reason: `Based on real performance: ${number(video.views)} views in ${video.contentPillar}.`
        }));
        if (box) box.innerHTML = ideas.map(idea => `<div class="result-card rounded-xl p-4"><p class="text-white font-semibold">${escapeHtml(idea.title)}</p><p class="creatorflow-muted">${escapeHtml(idea.reason)}</p></div>`).join('');
        $('content-results')?.classList.remove('hidden');
    };

    window.generateDescription = async function () {
        const input = $('desc-input')?.value?.trim();
        if (!input) return toast('Please enter a video title or topic.');
        try {
            const text = await window.callFreeAI(`Write a YouTube description for "${input}" using only available channel context. If channel analytics are missing, say what data is needed before making performance claims.`);
            $('desc-output').textContent = text;
            $('desc-results')?.classList.remove('hidden');
        } catch (error) {
            $('desc-output').textContent = 'AI provider is unavailable. Configure OPENAI_API_KEY or OPENROUTER_API_KEY to generate descriptions.';
            $('desc-results')?.classList.remove('hidden');
        }
    };

    window.generateHashtags = async function () {
        const input = $('hashtag-input')?.value?.trim();
        if (!input) return toast('Please enter a topic.');
        try {
            const text = await window.callFreeAI(`Generate YouTube hashtags for "${input}". Do not claim they are trending unless real trend data is provided. Return a short plain list.`);
            $('hashtag-output').innerHTML = `<div class="creatorflow-alert">${escapeHtml(text)}</div>`;
        } catch (error) {
            $('hashtag-output').innerHTML = '<div class="creatorflow-alert creatorflow-danger">AI provider is unavailable. Configure OPENAI_API_KEY or OPENROUTER_API_KEY.</div>';
        }
        $('hashtag-results')?.classList.remove('hidden');
    };

    window.researchKeywords = async function () {
        const input = $('keyword-input')?.value?.trim();
        if (!input) return toast('Please enter a seed keyword.');
        $('keyword-list').innerHTML = '<div class="creatorflow-alert">Keyword volume and difficulty require a real keyword data provider. No estimates are fabricated.</div>';
        $('keyword-results')?.classList.remove('hidden');
    };

    window.generateThumbnailPrompts = async function () {
        const input = $('thumb-input')?.value?.trim();
        if (!input) return toast('Please describe your thumbnail or video topic.');
        try {
            const text = await window.callFreeAI(`Create thumbnail image generation prompts for "${input}". Do not predict CTR. Focus on composition, text readability, and export-safe 16:9 packaging.`);
            ['prompt-dalle', 'prompt-midjourney', 'prompt-leonardo', 'prompt-ideogram'].forEach(id => {
                if ($(id)) $(id).textContent = text;
            });
            $('thumb-prompts')?.classList.remove('hidden');
        } catch (error) {
            toast('AI provider is unavailable.');
        }
    };

    window.analyzeThumbnail = function () {
        const file = $('thumbnail-upload')?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const aspect = img.width / img.height;
                const resolution = img.width >= 1280 && img.height >= 720 ? 100 : Math.round(Math.min(100, (img.width * img.height) / (1280 * 720) * 100));
                const aspectScore = Math.abs(aspect - 16 / 9) < 0.03 ? 100 : 60;
                const quality = Math.round((resolution * 0.7) + (aspectScore * 0.3));
                $('thumbnail-results')?.classList.remove('hidden');
                if (window.animateValue) {
                    window.animateValue('thumb-score', 0, quality, 600);
                    window.animateValue('thumb-ctr', 0, 0, 1, '%');
                    window.animateValue('thumb-mobile', 0, aspectScore, 600, '%');
                }
                if ($('thumb-res-score')) $('thumb-res-score').textContent = `${resolution}/100`;
                if ($('thumb-bright-score')) $('thumb-bright-score').textContent = 'Not analyzed';
                if ($('thumb-text-score')) $('thumb-text-score').textContent = 'Not analyzed';
                if ($('thumb-color-score')) $('thumb-color-score').textContent = 'Not analyzed';
                if ($('thumb-suggestions')) $('thumb-suggestions').innerHTML = [
                    `Resolution: ${img.width}x${img.height}.`,
                    aspectScore === 100 ? 'Aspect ratio is export-safe for YouTube 16:9.' : 'Crop to 16:9 before export.',
                    'Mobile readability requires visible text detection or manual review.',
                    'No CTR estimate is shown because no actual performance data exists for this thumbnail.'
                ].map(item => `<li class="flex items-start gap-2">${escapeHtml(item)}</li>`).join('');
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    };

    window.initCalendar = function () {
        const grid = $('calendar-grid');
        if (!grid) return;
        const videos = state.analytics?.videos || [];
        grid.innerHTML = videos.length
            ? videos.slice(0, 30).map((video, index) => `<div class="rounded-xl border border-lemon/20 p-2"><div class="text-xs text-gray-400">Day ${index + 1}</div><div class="text-[10px] text-lemon mt-1">${escapeHtml(video.contentPillar)}</div></div>`).join('')
            : `<div class="creatorflow-alert" style="grid-column:1/-1">${UNAVAILABLE}</div>`;
    };

    window.generateCalendarPlan = async function () {
        const videos = state.analytics?.videos || [];
        if (!videos.length) return toast(UNAVAILABLE);
        window.initCalendar();
        toast('Calendar built from stored channel evidence.');
    };

    window.analyzeVideoContent = function () {
        toast('Video comparison requires stored YouTube/API metrics or imported CSV metrics. No competitor stats are estimated.');
    };

    window.analyzeCompetitorGap = function () {
        toast('Competitor gap analysis needs real metrics for both selected videos. No estimates are fabricated.');
    };

    window.addEventListener('DOMContentLoaded', () => {
        injectShell();
        window.CreatorFlowNavigate('creatorflow-dashboard');
        refresh();
        const params = new URLSearchParams(location.search);
        if (params.get('youtube') === 'signin-required') toast('Sign in before connecting YouTube.');
    });
})();
