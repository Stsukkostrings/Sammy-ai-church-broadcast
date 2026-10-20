/*
 ============================================================
 SPIRITFLOW SOUNDS RADIO — shared player module
 ------------------------------------------------------------
 Extracted from spiritflow-sounds-radio.html so that the
 homepage (index.html) and the dedicated radio page use ONE
 implementation: one config, one stream service, one set of
 playback rules.

 Used by:
   - spiritflow-sounds-radio.html  (full page: player + schedule
                                   + programs + watch + submit)
   - index.html                   (compact player panel)

 Every element lookup is optional: pages render only the
 markup they need and the wiring skips what is missing.

 ENVIRONMENT-STYLE CONFIGURATION
   PUBLIC (safe for client):
     SPIRITFLOW_STREAM_URL          -> config.streamUrl
     SPIRITFLOW_YOUTUBE_LIVE_URL    -> config.youtubeLiveUrl
     SPIRITFLOW_YOUTUBE_CHANNEL_URL -> config.youtubeChannelUrl
   SERVER-SIDE ONLY (never in this file):
     SPIRITFLOW_AZURACAST_API_URL / _STATION_ID / _API_KEY
     are read by /api/spiritflow-config and
     /api/spiritflow/nowplaying (see api/_spiritFlowCore.js).

 This file contains NO mock radio data. When the stream / API
 are not configured, the UI reports CONNECTING / OFFLINE /
 "being configured" — it never pretends to be live.
 ============================================================
 */

var SPIRITFLOW_CONFIG = {
    streamUrl: "",            // e.g. "https://radio.yourserver.com/radio/8000/stream"  (PUBLIC)
    azuracast: {
        apiUrl: "",           // base URL of your AzuraCast instance (server-side only)
        stationId: "",        // e.g. "1"
        apiProxyEndpoint: "", // "/api/spiritflow/nowplaying" — same-origin server route
        pollIntervalMs: 30000 // sensible, non-aggressive polling
    },
    youtubeLiveUrl: "",       // PUBLIC
    youtubeChannelUrl: "",    // PUBLIC
    submitMusicUrl: "contact.html",
    socialLinks: [            // leave href empty to hide an icon
        { label: "Instagram", href: "", svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>' },
        { label: "YouTube", href: "", svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23 12s0-3.9-.5-5.6c-.3-1-1.1-1.8-2.1-2C18.6 4 12 4 12 4s-6.6 0-8.4.4c-1 .3-1.8 1-2.1 2C1 8.1 1 12 1 12s0 3.9.5 5.6c.3 1 1.1 1.8 2.1 2 1.8.4 8.4.4 8.4.4s6.6 0 8.4-.4c-1 0 1.8-1 2.1-2 .5-1.7.5-5.6.5-5.6ZM9.8 15.6V8.4L15.9 12l-6.1 3.6Z"/></svg>' },
        { label: "X", href: "", svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-6.8 7.8L23.3 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L1 2h6.5l4.4 5.8L18.9 2Zm-1.1 18h1.7L7.1 3.9H5.3L17.8 20Z"/></svg>' },
        { label: "Facebook", href: "", svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M14 8.5V6.8c0-.8.5-1 .9-1H17V2.5h-2.6C11.2 2.5 10 4.6 10 6.5v2H7.5V12H10v9.5h4V12h2.7l.4-3.5H14Z"/></svg>' }
    ],
    /* Editable programming config — NOT presented as live data.
       Replace or sync with AzuraCast scheduling when available. */
    programs: [
        { time: "06:00", name: "Morning Flow", desc: "A gentle Afro-Gospel rise — scripture, soft rhythms and first-light worship to start the day." },
        { time: "10:00", name: "Afro Gospel Power", desc: "High-energy praise from across the continent. Drums, joy and unstoppable gratitude." },
        { time: "13:00", name: "Worship & Prayer", desc: "Midday reflection. Deep worship sets and guided prayer for the heart of your day." },
        { time: "16:00", name: "Afro-Rock Gospel", desc: "Where electric guitars meet heaven — bold African gospel rock with a message." },
        { time: "19:00", name: "Evening Worship", desc: "Slow down with sunset worship, testimonies and songs of surrender." },
        { time: "22:00", name: "SpiritFlow Night", desc: "Ambient worship and night-time inspiration to carry you into rest." }
    ],
    schedule: [
        { time: "06:00", name: "Morning Flow", tag: "Weekdays" },
        { time: "10:00", name: "Afro Gospel Power", tag: "Daily" },
        { time: "13:00", name: "Worship & Prayer", tag: "Daily" },
        { time: "16:00", name: "Afro-Rock Gospel", tag: "Mon / Wed / Fri" },
        { time: "19:00", name: "Evening Worship", tag: "Daily" },
        { time: "22:00", name: "SpiritFlow Night", tag: "Nightly" }
    ]
};

function startSpiritFlow() {
    /* ============================================================
       radioService — clean data abstraction over AzuraCast.
       All API access flows through here; the UI never calls
       AzuraCast directly. Private API keys never reach the client:
       `apiProxyEndpoint` is a same-origin server-side route.
       ============================================================ */
    var radioService = (function () {
        var cfg = SPIRITFLOW_CONFIG.azuracast;

        function endpoint(path) {
            if (cfg.apiProxyEndpoint) return cfg.apiProxyEndpoint + path; // server proxy (recommended)
            if (cfg.apiUrl && cfg.stationId) return cfg.apiUrl + "/api/nowplaying/" + encodeURIComponent(cfg.stationId); // public endpoint
            return null;
        }

        async function getNowPlaying() {
            var url = endpoint("nowplaying");
            if (!url) return { configured: false };
            var res = await fetch(url, { headers: { "Accept": "application/json" } });
            if (!res.ok) throw new Error("Station service responded " + res.status);
            var data = await res.json();
            /* Normalise the public AzuraCast now-playing payload */
            var np = data.now_playing || {};
            return {
                configured: true,
                online: typeof data.is_online === "boolean" ? data.is_online : null,
                listeners: (data.listeners && (data.listeners.current != null ? data.listeners.current : data.listeners.total)) != null
                    ? (data.listeners.current != null ? data.listeners.current : data.listeners.total)
                    : null,
                song: np.song ? {
                    title: np.song.title || "Unknown title",
                    artist: np.song.artist || "Unknown artist",
                    art: np.song.art || null
                } : null,
                history: Array.isArray(data.song_history) ? data.song_history.slice(0, 5).map(function (h) {
                    return {
                        title: (h.song && h.song.title) || "Unknown title",
                        artist: (h.song && h.song.artist) || "Unknown artist",
                        art: (h.song && h.song.art) || null,
                        playedAt: h.played_at || null
                    };
                }) : []
            };
        }

        return { getNowPlaying: getNowPlaying, isConfigured: function () { return !!endpoint("nowplaying"); } };
    })();

    /* ============================================================
       UI wiring — only touches elements that exist on the page
       ============================================================ */
    (function () {
        var $ = function (id) { return document.getElementById(id); };
        var audio = $("sfrAudio");
        if (!audio) return;

        var playBtn = $("sfrPlayBtn"), playIcon = $("sfrPlayIcon");
        var statuses = [$("sfrStatusTop"), $("sfrStatusPlayer")].filter(Boolean);
        var livebar = $("sfrLivebar"), eq = $("sfrEq");
        var ICON_PLAY = '<path d="M8 5.5v13l11-6.5-11-6.5Z"/>';
        var ICON_PAUSE = '<path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/>';

        var STATE_LABEL = { live: "Live", connecting: "Connecting", offline: "Offline", error: "Connection error" };

        function setState(state) {
            statuses.forEach(function (el) {
                el.dataset.state = state;
                var txt = el.querySelector(".sfr-status-text");
                if (txt) txt.textContent = STATE_LABEL[state];
            });
            if (livebar) livebar.classList.toggle("on", state === "live");
            if (eq) eq.classList.toggle("on", state === "live");
        }

        function setPlaying(playing) {
            if (playIcon) playIcon.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
            if (playBtn) {
                playBtn.setAttribute("aria-pressed", String(playing));
                playBtn.setAttribute("aria-label", playing ? "Pause live stream" : "Play live stream");
            }
        }

        /* ---- stream configuration ---- */
        var streamConfigured = !!SPIRITFLOW_CONFIG.streamUrl;
        if (streamConfigured) audio.src = SPIRITFLOW_CONFIG.streamUrl;
        else {
            var configNote = $("sfrConfigNote");
            if (configNote) configNote.hidden = false;
            setState("offline");
        }

        async function togglePlay() {
            if (!streamConfigured) { setState("offline"); return; }
            if (audio.paused) {
                setState("connecting");
                var volInput = $("sfrVol");
                if (volInput) audio.volume = parseFloat(volInput.value);
                try { await audio.play(); } catch (e) { setState("error"); setPlaying(false); }
            } else {
                audio.pause();
            }
        }

        if (playBtn) playBtn.addEventListener("click", togglePlay);
        var heroBtn = $("sfrListenHero");
        if (heroBtn) {
            heroBtn.addEventListener("click", function () {
                var listenSection = document.getElementById("spiritflow-listen");
                if (listenSection) listenSection.scrollIntoView({ behavior: "smooth", block: "start" });
                if (audio.paused) togglePlay();
            });
        }

        audio.addEventListener("playing", function () { setState("live"); setPlaying(true); });
        audio.addEventListener("waiting", function () { setState("connecting"); });
        audio.addEventListener("pause", function () { setPlaying(false); if (streamConfigured) setState("offline"); });
        audio.addEventListener("error", function () { setState(streamConfigured ? "error" : "offline"); setPlaying(false); });
        audio.addEventListener("stalled", function () { setState("connecting"); });

        /* ---- volume / mute ---- */
        var vol = $("sfrVol"), muteBtn = $("sfrMuteBtn");
        function syncMute() {
            if (!muteBtn) return;
            muteBtn.setAttribute("aria-pressed", String(audio.muted));
            muteBtn.setAttribute("aria-label", audio.muted ? "Unmute" : "Mute");
            var waves = muteBtn.querySelector(".sfr-vol-waves");
            if (waves) waves.style.opacity = audio.muted ? ".25" : "1";
        }
        if (vol) {
            vol.addEventListener("input", function () {
                audio.volume = parseFloat(vol.value);
                if (audio.volume > 0) { audio.muted = false; syncMute(); }
            });
        }
        if (muteBtn) {
            muteBtn.addEventListener("click", function () { audio.muted = !audio.muted; syncMute(); });
        }

        /* ---- Now Playing + Recently Played (AzuraCast, no mock data) ---- */
        var recentEl = $("sfrRecent");
        async function refreshNowPlaying() {
            try {
                var data = await radioService.getNowPlaying();
                if (!data.configured) {
                    var recentNote0 = $("sfrRecentNote");
                    if (recentNote0) recentNote0.hidden = false;
                    return;
                }
                var recentNote = $("sfrRecentNote");
                if (recentNote) recentNote.hidden = true;

                if (data.song) {
                    var titleEl = $("sfrTrackTitle");
                    var artistEl = $("sfrTrackArtist");
                    if (titleEl) titleEl.textContent = data.song.title;
                    if (artistEl) artistEl.textContent = data.song.artist;
                    if (data.song.art) {
                        var img = document.querySelector(".sfr-art img.artwork");
                        if (!img) {
                            img = document.createElement("img");
                            img.className = "artwork";
                            img.alt = "Album artwork for " + data.song.title;
                            img.loading = "lazy";
                            var art = document.querySelector(".sfr-art");
                            if (art) art.prepend(img);
                        }
                        if (img.src !== data.song.art) img.src = data.song.art;
                    }
                }
                if (data.online === false && audio.paused) setState("offline");

                if (recentEl) {
                    if (data.history.length) {
                        recentEl.innerHTML = "";
                        data.history.forEach(function (h, i) {
                            var row = document.createElement("div");
                            row.className = "sfr-recent-item";
                            row.innerHTML =
                                '<span class="sfr-idx" aria-hidden="true">' + (i + 1) + '</span>' +
                                '<span class="sfr-rart">' + (h.art ? '<img src="' + h.art + '" alt="" loading="lazy">' : "") + '</span>' +
                                '<span class="sfr-rt"><b></b><span></span></span>';
                            row.querySelector("b").textContent = h.title;
                            row.querySelector(".sfr-rt span").textContent = h.artist;
                            recentEl.appendChild(row);
                        });
                    } else if (recentNote && recentNote.hidden) {
                        recentEl.innerHTML = '<p class="sfr-recent-empty">Track history will appear here once the station is on air.</p>';
                    }
                }
            } catch (e) {
                var note = $("sfrRecentNote");
                if (note) {
                    note.hidden = false;
                    note.textContent = "Unable to reach the station service right now. SpiritFlow Radio may be offline.";
                }
            }
        }
        if (radioService.isConfigured()) {
            refreshNowPlaying();
            setInterval(refreshNowPlaying, Math.max(SPIRITFLOW_CONFIG.azuracast.pollIntervalMs, 15000));
        } else {
            var recentNoteOffline = $("sfrRecentNote");
            if (recentNoteOffline) recentNoteOffline.hidden = false;
        }

        /* ---- Programs + Schedule (clearly-marked editable config) ---- */
        var progEl = $("sfrPrograms");
        if (progEl) {
            SPIRITFLOW_CONFIG.programs.forEach(function (p) {
                var card = document.createElement("article");
                card.className = "sfr-prog";
                card.innerHTML = '<p class="sfr-prog-time"></p><h3></h3><p></p>';
                card.querySelector(".sfr-prog-time").textContent = p.time;
                card.querySelector("h3").textContent = p.name;
                card.querySelector("p:last-child").textContent = p.desc;
                progEl.appendChild(card);
            });
        }

        var schedEl = $("sfrSchedule");
        if (schedEl) {
            SPIRITFLOW_CONFIG.schedule.forEach(function (s) {
                var row = document.createElement("div");
                row.className = "sfr-sched-row";
                row.innerHTML = '<span class="sfr-sched-time"></span><span class="sfr-sched-name"></span><span class="sfr-sched-tag"></span>';
                row.querySelector(".sfr-sched-time").textContent = s.time;
                row.querySelector(".sfr-sched-name").textContent = s.name;
                row.querySelector(".sfr-sched-tag").textContent = s.tag;
                schedEl.appendChild(row);
            });
        }

        /* ---- YouTube (no broken embeds, no stream keys, ever) ---- */
        var ytBtn = $("sfrYtBtn"), ytFrame = $("sfrYtFrame");
        if (ytBtn && ytFrame) {
            var ytUrl = SPIRITFLOW_CONFIG.youtubeLiveUrl || SPIRITFLOW_CONFIG.youtubeChannelUrl;
            if (ytUrl) {
                ytBtn.href = ytUrl;
                ytBtn.removeAttribute("aria-disabled");
                if (SPIRITFLOW_CONFIG.youtubeLiveUrl) {
                    ytFrame.innerHTML = '<iframe src="' + SPIRITFLOW_CONFIG.youtubeLiveUrl.replace("watch?v=", "embed/") + '" title="SpiritFlow Sounds Radio live on YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>';
                }
            } else {
                ytBtn.setAttribute("aria-disabled", "true");
                ytBtn.addEventListener("click", function (e) { e.preventDefault(); });
            }
        }

        /* ---- Submit + socials ---- */
        var submitBtn = $("sfrSubmitBtn");
        if (submitBtn) submitBtn.href = SPIRITFLOW_CONFIG.submitMusicUrl;
        var socEl = $("sfrSocials");
        if (socEl) {
            SPIRITFLOW_CONFIG.socialLinks.filter(function (s) { return s.href; }).forEach(function (s) {
                var a = document.createElement("a");
                a.className = "sfr-social";
                a.href = s.href;
                a.target = "_blank";
                a.rel = "noopener";
                a.setAttribute("aria-label", s.label);
                a.innerHTML = s.svg;
                socEl.appendChild(a);
            });
        }
    })();
}

/* Bootstrap: load public runtime configuration from the server,
   then start the player. When configuration is unavailable the
   page reports CONNECTING / OFFLINE / "being configured" — it
   never invents live data. */
(async function () {
    try {
        var res = await fetch('/api/spiritflow-config', { headers: { 'Accept': 'application/json' } });
        if (res.ok) {
            var cfg = await res.json();
            if (cfg.streamUrl) SPIRITFLOW_CONFIG.streamUrl = cfg.streamUrl;
            if (cfg.youtubeLiveUrl) SPIRITFLOW_CONFIG.youtubeLiveUrl = cfg.youtubeLiveUrl;
            if (cfg.youtubeChannelUrl) SPIRITFLOW_CONFIG.youtubeChannelUrl = cfg.youtubeChannelUrl;
            if (cfg.submitMusicUrl) SPIRITFLOW_CONFIG.submitMusicUrl = cfg.submitMusicUrl;
            if (cfg.nowPlayingEndpoint) SPIRITFLOW_CONFIG.azuracast.apiProxyEndpoint = '/api/spiritflow/';
        }
    } catch (e) { /* config endpoint unavailable — UI shows "being configured" state */ }
    startSpiritFlow();
})();
