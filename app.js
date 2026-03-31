/*
 AI Church Broadcast
 © 2026 Samuel Olasunkanmi
 Unauthorized use is prohibited
*/

let audioContext;
let analyser;
let dataArray;
let micStream;
let recognition;
let usingNativeSpeech = false;
let nativeSpeechListenersAttached = false;
let speechStoppedManually = false;
let animationFrameId = null;
let deferredPrompt = null;

const STORAGE_KEYS = {
    archive: "ai_cb_archive_sessions_v2",
    planner: "ai_cb_planner_progress_v2"
};

const DEFAULT_PLANNER = [
    { id: "welcome-loop", title: "Welcome Loop + Opening Lower Third", role: "Media Desk", time: "08:45" },
    { id: "worship-set", title: "Worship Set Graphics", role: "Lyrics Operator", time: "09:00" },
    { id: "sermon-capture", title: "Sermon Capture + Notes", role: "Broadcast Lead", time: "09:35" },
    { id: "prayer-response", title: "Prayer / Response Screen", role: "Stage Display", time: "10:20" },
    { id: "announcements", title: "Announcements + Outro", role: "Media Desk", time: "10:35" }
];

const state = {
    session: window.AuthStore ? window.AuthStore.getSession() : null,
    sermonNotes: [],
    references: [],
    archive: readStorage(STORAGE_KEYS.archive, []),
    plannerDone: readStorage(STORAGE_KEYS.planner, [])
};

const dom = {
    appRoot: document.getElementById("workspace"),
    canvas: document.getElementById("waveCanvas"),
    speechText: document.getElementById("speechText"),
    speechHint: document.getElementById("speechHint"),
    listenButton: document.getElementById("listenButton"),
    clearNotesButton: document.getElementById("clearNotesButton"),
    notesBox: document.getElementById("notesBox"),
    verseInput: document.getElementById("verseInput"),
    verseButton: document.getElementById("verseButton"),
    overlayText: document.getElementById("overlayText"),
    summaryText: document.getElementById("summaryText"),
    detectedReferences: document.getElementById("detectedReferences"),
    promoSnippet: document.getElementById("promoSnippet"),
    archiveButton: document.getElementById("archiveButton"),
    archiveList: document.getElementById("archiveList"),
    archiveCount: document.getElementById("archiveCount"),
    plannerList: document.getElementById("plannerList"),
    plannerProgress: document.getElementById("plannerProgress"),
    micStatus: document.getElementById("micStatus"),
    sessionTitle: document.getElementById("sessionTitle"),
    workspaceGreeting: document.getElementById("workspaceGreeting"),
    authMessage: document.getElementById("authMessage"),
    authSessionCard: document.getElementById("authSessionCard"),
    sessionUserName: document.getElementById("sessionUserName"),
    sessionUserEmail: document.getElementById("sessionUserEmail"),
    logoutButton: document.getElementById("logoutButton"),
    loginForm: document.getElementById("loginForm"),
    signupForm: document.getElementById("signupForm"),
    verifyForm: document.getElementById("verifyForm"),
    showLogin: document.getElementById("showLogin"),
    showSignup: document.getElementById("showSignup"),
    signupName: document.getElementById("signupName"),
    signupEmail: document.getElementById("signupEmail"),
    signupPassword: document.getElementById("signupPassword"),
    signupConfirm: document.getElementById("signupConfirm"),
    verifyEmail: document.getElementById("verifyEmail"),
    verifyCode: document.getElementById("verifyCode"),
    resendCodeButton: document.getElementById("resendCodeButton"),
    loginEmail: document.getElementById("loginEmail"),
    loginPassword: document.getElementById("loginPassword"),
    downloadButton: document.getElementById("downloadButton"),
    shareButton: document.getElementById("shareButton"),
    installButton: document.getElementById("installBtn")
};

const canvasContext = dom.canvas ? dom.canvas.getContext("2d") : null;
const obs = typeof OBSWebSocket !== "undefined" ? new OBSWebSocket() : null;
let authMode = window.AuthStore?.getPendingVerificationEmail?.() ? "verify" : "login";

init();

function init() {
    renderAuthState();
    bindAuth();
    setupPwaInstall();

    if (!dom.appRoot) {
        return;
    }

    bindWorkspace();
    renderPlanner();
    renderArchive();
    syncNotesFromTextarea();
    refreshWorkspace();
    connectOBS();
}

function bindAuth() {
    dom.showLogin?.addEventListener("click", () => toggleAuthMode("login"));
    dom.showSignup?.addEventListener("click", () => toggleAuthMode("signup"));

    dom.signupForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (dom.signupPassword.value !== dom.signupConfirm.value) {
            setAuthMessage("Passwords do not match.", true);
            return;
        }

        try {
            const result = await window.AuthStore.register({
                fullName: dom.signupName.value.trim(),
                email: dom.signupEmail.value.trim(),
                password: dom.signupPassword.value
            });
            showVerificationStep(result.email);
            setAuthMessage(result.message || "Enter the verification code sent to your email.");
        } catch (err) {
            setAuthMessage(err.message || "Unable to create account.", true);
        }
    });

    dom.verifyForm?.addEventListener("submit", async (event) => {
        event.preventDefault();

        try {
            state.session = await window.AuthStore.verifyEmail({
                email: dom.verifyEmail?.value.trim(),
                code: dom.verifyCode?.value.trim()
            });
            authMode = "login";
            setAuthMessage("Email verified. Studio access is ready.");
            window.renderNavbar?.();
            renderAuthState();
            refreshWorkspace();
        } catch (err) {
            setAuthMessage(err.message || "Unable to verify your email.", true);
        }
    });

    dom.resendCodeButton?.addEventListener("click", async () => {
        try {
            const result = await window.AuthStore.resendVerification(dom.verifyEmail?.value.trim());
            showVerificationStep(result.email);
            setAuthMessage(result.message || "A new verification code has been sent.");
        } catch (err) {
            setAuthMessage(err.message || "Unable to resend verification code.", true);
        }
    });

    dom.loginForm?.addEventListener("submit", async (event) => {
        event.preventDefault();

        try {
            state.session = await window.AuthStore.login({
                email: dom.loginEmail.value.trim(),
                password: dom.loginPassword.value
            });
            authMode = "login";
            setAuthMessage("Logged in successfully.");
            window.renderNavbar?.();
            renderAuthState();
            refreshWorkspace();
        } catch (err) {
            if (err.pendingVerification) {
                showVerificationStep(err.email || dom.loginEmail.value.trim());
                setAuthMessage(err.message || "Verify your email before logging in.", true);
                return;
            }
            setAuthMessage(err.message || "Unable to log in.", true);
        }
    });

    dom.logoutButton?.addEventListener("click", () => {
        window.AuthStore.logout();
        state.session = null;
        setAuthMessage("You have been logged out.");
        window.renderNavbar?.();
        authMode = window.AuthStore?.getPendingVerificationEmail?.() ? "verify" : "login";
        renderAuthState();
        refreshWorkspace();
            window.location.href = window.AuthStore?.getHomePath?.() || "index.html";
    });
}

function bindWorkspace() {
    dom.listenButton?.addEventListener("click", async () => {
        if (micStream || recognition || usingNativeSpeech) {
            await stopMic();
            refreshMicUi("Mic status");
            return;
        }

        await startMic();
    });

    dom.clearNotesButton?.addEventListener("click", clearNotes);
    dom.verseButton?.addEventListener("click", manualFetch);
    dom.archiveButton?.addEventListener("click", archiveCurrentSession);
    dom.downloadButton?.addEventListener("click", downloadNotes);
    dom.shareButton?.addEventListener("click", shareNotes);
    dom.sessionTitle?.addEventListener("input", updateGeneratedContent);

    dom.notesBox?.addEventListener("input", () => {
        syncNotesFromTextarea();
        updateGeneratedContent();
    });
}

function toggleAuthMode(mode) {
    authMode = mode;
    renderAuthState();
}

function showVerificationStep(email) {
    authMode = "verify";
    const normalizedEmail = window.AuthStore?.setPendingVerificationEmail?.(email) || email;

    if (dom.verifyEmail) {
        dom.verifyEmail.value = normalizedEmail || "";
    }

    if (dom.verifyCode) {
        dom.verifyCode.value = "";
        dom.verifyCode.focus();
    }

    renderAuthState();
}

function renderAuthState() {
    const session = state.session;
    const loggedIn = !!session;
    const loginTabActive = authMode === "login";
    const verifyMode = authMode === "verify";

    dom.authSessionCard?.classList.toggle("is-hidden", !loggedIn);
    dom.loginForm?.classList.toggle("is-hidden", loggedIn || !loginTabActive);
    dom.signupForm?.classList.toggle("is-hidden", loggedIn || loginTabActive || verifyMode);
    dom.verifyForm?.classList.toggle("is-hidden", loggedIn || !verifyMode);
    dom.showLogin?.classList.toggle("is-hidden", loggedIn);
    dom.showSignup?.classList.toggle("is-hidden", loggedIn);
    dom.showLogin?.classList.toggle("active", authMode === "login");
    dom.showSignup?.classList.toggle("active", authMode !== "login");

    if (!loggedIn && dom.verifyEmail && !dom.verifyEmail.value) {
        dom.verifyEmail.value = window.AuthStore?.getPendingVerificationEmail?.() || "";
    }

    if (loggedIn) {
        const firstName = session.fullName.split(" ")[0] || session.fullName;
        if (dom.sessionUserName) {
            dom.sessionUserName.textContent = `Welcome ${firstName}`;
        }
        if (dom.sessionUserEmail) {
            dom.sessionUserEmail.textContent = session.email;
        }
        if (dom.workspaceGreeting) {
            dom.workspaceGreeting.textContent = `Welcome ${firstName}`;
        }
    } else if (dom.workspaceGreeting) {
        dom.workspaceGreeting.textContent = "Welcome Guest";
    }
}

function setAuthMessage(message, isError = false) {
    if (!dom.authMessage) {
        return;
    }

    dom.authMessage.textContent = message || "";
    dom.authMessage.classList.toggle("error", !!message && isError);
    dom.authMessage.classList.toggle("success", !!message && !isError);
}

async function connectOBS() {
    if (!obs) {
        return;
    }

    try {
        await obs.connect("ws://127.0.0.1:4455", "123456");
    } catch (err) {
        console.warn("OBS connection unavailable:", err);
    }
}

function getNativeSpeechPlugin() {
    return window.Capacitor?.Plugins?.AndroidSpeech || null;
}

function isAndroidApp() {
    return window.Capacitor?.getPlatform?.() === "android";
}

async function shouldUseNativeSpeech() {
    if (!isAndroidApp()) {
        return false;
    }

    const plugin = getNativeSpeechPlugin();
    if (!plugin) {
        return false;
    }

    try {
        const result = await plugin.isAvailable();
        return !!result.available;
    } catch (err) {
        return false;
    }
}

async function ensureNativeSpeechListeners() {
    if (nativeSpeechListenersAttached) {
        return;
    }

    const plugin = getNativeSpeechPlugin();
    if (!plugin) {
        return;
    }

    await plugin.addListener("partialResults", (event) => {
        const transcript = firstTranscript(event.matches);
        if (transcript) {
            dom.speechText.textContent = transcript;
            dom.speechHint.textContent = "Listening... waiting for the next phrase.";
        }
    });

    await plugin.addListener("finalResults", (event) => {
        const transcript = firstTranscript(event.matches);
        if (!transcript) {
            return;
        }

        saveNote(transcript);
        dom.speechText.textContent = transcript;
    });

    await plugin.addListener("error", (event) => {
        dom.speechHint.textContent = event?.message || "Speech recognition failed.";
    });

    nativeSpeechListenersAttached = true;
}

function firstTranscript(matches) {
    return Array.isArray(matches) && matches.length ? String(matches[0] || "").trim() : "";
}

async function startMic() {
    try {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("This browser does not support microphone access.");
        }

        micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            throw new Error("This browser does not support Web Audio.");
        }

        audioContext = new AudioContextClass();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        audioContext.createMediaStreamSource(micStream).connect(analyser);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        speechStoppedManually = false;
        refreshMicUi("Listening");
        drawWave();
        await startSpeech();
    } catch (err) {
        alert(getMicErrorMessage(err));
        refreshMicUi("Mic status");
    }
}

async function stopMic() {
    speechStoppedManually = true;

    if (usingNativeSpeech) {
        try {
            await getNativeSpeechPlugin()?.stopListening();
        } catch (err) {
            console.warn("Native speech stop failed:", err);
        }
        usingNativeSpeech = false;
    }

    if (recognition) {
        recognition.onend = null;
        try {
            recognition.stop();
        } catch (err) {
            console.warn("Speech stop failed:", err);
        }
    }

    recognition = null;
    micStream?.getTracks().forEach((track) => track.stop());
    micStream = null;

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    if (audioContext && audioContext.state !== "closed") {
        await audioContext.close().catch(() => {});
    }

    audioContext = null;
    analyser = null;
    dataArray = null;
    canvasContext?.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
    dom.speechHint.textContent = "Listening paused.";
    dom.listenButton.textContent = "Start Listening";
}

function drawWave() {
    if (!canvasContext || !dom.canvas) {
        return;
    }

    animationFrameId = requestAnimationFrame(drawWave);
    if (!analyser || !dataArray) {
        canvasContext.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
        return;
    }

    analyser.getByteTimeDomainData(dataArray);
    canvasContext.fillStyle = "#120d0b";
    canvasContext.fillRect(0, 0, dom.canvas.width, dom.canvas.height);
    canvasContext.lineWidth = 2;
    canvasContext.strokeStyle = "#ffb164";
    canvasContext.beginPath();

    const sliceWidth = dom.canvas.width / dataArray.length;
    let x = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const y = (dataArray[i] / 128.0) * (dom.canvas.height / 2);
        if (i === 0) {
            canvasContext.moveTo(x, y);
        } else {
            canvasContext.lineTo(x, y);
        }
        x += sliceWidth;
    }

    canvasContext.stroke();
}

async function startSpeech() {
    if (await shouldUseNativeSpeech()) {
        const plugin = getNativeSpeechPlugin();
        if (plugin) {
            await ensureNativeSpeechListeners();
            usingNativeSpeech = true;
            await plugin.startListening({ language: "en-US" });
            return;
        }
    }

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
        dom.speechHint.textContent = "Mic is active, but speech recognition is not supported on this device.";
        return;
    }

    recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
        let interimText = "";
        let finalText = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.trim();
            if (event.results[i].isFinal) {
                finalText += `${transcript} `;
                saveNote(transcript);
            } else {
                interimText += `${transcript} `;
            }
        }

        dom.speechText.textContent = (interimText || finalText || "Waiting...").trim();
        dom.speechHint.textContent = "Listening... waiting for the next phrase.";
    };

    recognition.onerror = (event) => {
        dom.speechHint.textContent = event.error || "Speech recognition failed.";
    };

    recognition.onend = () => {
        if (!speechStoppedManually) {
            try {
                recognition.start();
            } catch (err) {
                console.warn("Speech restart failed:", err);
            }
        }
    };

    recognition.start();
}

function saveNote(text) {
    const cleanText = String(text || "").trim();
    if (!cleanText) {
        return;
    }

    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    state.sermonNotes.push(`[${time}] ${cleanText}`);
    dom.notesBox.value = state.sermonNotes.join("\n");
    detectBible(cleanText);
    updateGeneratedContent();
}

function clearNotes() {
    state.sermonNotes = [];
    state.references = [];
    dom.notesBox.value = "";
    dom.overlayText.textContent = "Fetched scripture will appear here for display.";
    updateGeneratedContent();
}

function syncNotesFromTextarea() {
    if (!dom.notesBox) {
        return;
    }

    state.sermonNotes = dom.notesBox.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    rebuildDetectedReferences();
}

function detectBible(text) {
    const regex = /\b([1-3]?\s?[A-Za-z]+)\s+(\d+):(\d+)\b/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
        let book = match[1].toLowerCase().replace(/\s+/g, " ").trim();
        if (book === "mathew") {
            book = "matthew";
        }
        if (book === "johnn") {
            book = "john";
        }

        const reference = `${capitalizeWords(book)} ${match[2]}:${match[3]}`;
        if (!state.references.includes(reference)) {
            state.references.push(reference);
        }
    }
    renderReferences();
}

function rebuildDetectedReferences() {
    state.references = [];
    state.sermonNotes.forEach((line) => detectBible(line));
    renderReferences();
}

function renderReferences() {
    if (dom.detectedReferences) {
        dom.detectedReferences.textContent = state.references.length ? state.references.join(", ") : "none yet";
    }
}

async function fetchVerse(reference) {
    try {
        const response = await fetch(`https://bible-api.com/${encodeURIComponent(reference)}`);
        const payload = await response.json();
        dom.overlayText.textContent = payload?.text ? payload.text.trim() : "Verse not found.";
        if (payload?.text) {
            await sendToOBS(payload.text.trim());
        }
    } catch (err) {
        dom.overlayText.textContent = "Error fetching verse.";
    }
}

async function sendToOBS(text) {
    if (!obs) {
        return;
    }

    try {
        await obs.call("SetInputSettings", {
            inputName: "BibleOverlay",
            inputSettings: { text },
            overlay: true
        });
    } catch (err) {
        console.warn("OBS send failed:", err);
    }
}

function manualFetch() {
    const reference = dom.verseInput.value.trim();
    if (!reference) {
        alert("Type a Bible reference first.");
        return;
    }

    fetchVerse(reference);
}

function updateGeneratedContent() {
    renderReferences();
    const summary = generateSummary();
    if (dom.summaryText) {
        dom.summaryText.textContent = summary;
    }
    if (dom.promoSnippet) {
        dom.promoSnippet.textContent = generatePromo(summary);
    }
}

function generateSummary() {
    if (!state.sermonNotes.length) {
        return "Start listening or type sermon notes to generate a summary.";
    }

    const joined = state.sermonNotes.join(" ").replace(/\[[^\]]+\]\s*/g, "");
    const lower = joined.toLowerCase();
    const themeWords = ["faith", "grace", "hope", "love", "worship", "jesus", "truth", "church", "prayer", "spirit"];
    const themes = themeWords.filter((word) => lower.includes(word));
    const title = dom.sessionTitle.value.trim() || "Untitled Service Session";
    const preview = truncateText(joined, 180);
    const themeText = themes.length ? ` Key themes: ${themes.slice(0, 4).join(", ")}.` : "";
    return `${title}: ${preview}.${themeText}`;
}

function generatePromo(summary) {
    const base = summary === "Start listening or type sermon notes to generate a summary."
        ? summary
        : summary.replace(/^.*?:\s*/, "");
    return `Tonight's message is centered on a powerful word for the church. Key takeaway: ${truncateText(base, 160)}`;
}

function archiveCurrentSession() {
    syncNotesFromTextarea();
    if (!state.sermonNotes.length) {
        alert("Add sermon notes before archiving a session.");
        return;
    }

    state.archive.unshift({
        id: Date.now(),
        title: dom.sessionTitle.value.trim() || "Untitled Service Session",
        summary: generateSummary(),
        createdAt: new Date().toISOString()
    });
    writeStorage(STORAGE_KEYS.archive, state.archive);
    renderArchive();
}

function renderArchive() {
    if (!dom.archiveList) {
        return;
    }

    dom.archiveCount.textContent = String(state.archive.length);
    if (!state.archive.length) {
        dom.archiveList.innerHTML = '<div class="archive-empty"><strong>Archive Empty</strong><p>Save a sermon session from Overview to populate your history.</p></div>';
        return;
    }

    dom.archiveList.innerHTML = state.archive.slice(0, 6).map((entry) => `
        <article class="archive-item">
            <strong>${escapeHtml(entry.title)}</strong>
            <p class="archive-meta">${formatArchiveDate(entry.createdAt)}</p>
            <p>${escapeHtml(truncateText(entry.summary, 160))}</p>
        </article>
    `).join("");
}

function renderPlanner() {
    if (!dom.plannerList) {
        return;
    }

    dom.plannerList.innerHTML = DEFAULT_PLANNER.map((item) => {
        const done = state.plannerDone.includes(item.id);
        return `
            <div class="planner-item ${done ? "done" : ""}">
                <div>
                    <strong>${escapeHtml(item.title)}</strong>
                    <div class="planner-meta">${escapeHtml(item.role)} • ${escapeHtml(item.time)}</div>
                </div>
                <button class="button-secondary planner-toggle" data-planner-id="${escapeHtml(item.id)}" type="button">${done ? "Completed" : "Mark Done"}</button>
            </div>
        `;
    }).join("");

    dom.plannerList.querySelectorAll(".planner-toggle").forEach((button) => {
        button.addEventListener("click", () => togglePlanner(button.dataset.plannerId));
    });

    refreshPlannerStats();
}

function togglePlanner(itemId) {
    if (state.plannerDone.includes(itemId)) {
        state.plannerDone = state.plannerDone.filter((entry) => entry !== itemId);
    } else {
        state.plannerDone = [...state.plannerDone, itemId];
    }

    writeStorage(STORAGE_KEYS.planner, state.plannerDone);
    renderPlanner();
}

function refreshPlannerStats() {
    if (dom.plannerProgress) {
        dom.plannerProgress.textContent = `${state.plannerDone.length}/${DEFAULT_PLANNER.length}`;
    }
}

function refreshWorkspace() {
    renderAuthState();
    updateGeneratedContent();
    renderArchive();
    refreshPlannerStats();
    refreshMicUi(micStream || recognition || usingNativeSpeech ? "Listening" : "Mic status");
}

function refreshMicUi(statusText) {
    if (dom.micStatus) {
        dom.micStatus.textContent = statusText;
    }
    if (dom.listenButton) {
        dom.listenButton.textContent = micStream || recognition || usingNativeSpeech ? "Stop Listening" : "Start Listening";
    }
}

function downloadNotes() {
    syncNotesFromTextarea();
    if (!state.sermonNotes.length) {
        alert("No notes to download.");
        return;
    }

    const blob = new Blob([state.sermonNotes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sermon_notes.txt";
    link.click();
    URL.revokeObjectURL(url);
}

async function shareNotes() {
    syncNotesFromTextarea();
    if (!state.sermonNotes.length) {
        alert("No notes to share.");
        return;
    }

    const payload = {
        title: dom.sessionTitle.value.trim() || "Service Session",
        text: state.sermonNotes.join("\n")
    };

    if (navigator.share) {
        try {
            await navigator.share(payload);
            return;
        } catch (err) {
            console.warn("Share cancelled or failed:", err);
        }
    }

    try {
        await navigator.clipboard.writeText(payload.text);
        alert("Notes copied to clipboard.");
    } catch (err) {
        alert("Unable to share notes on this device.");
    }
}

function setupPwaInstall() {
    if (!dom.installButton) {
        return;
    }

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
        navigator.serviceWorker.register("sw.js").catch(() => {});
    }

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferredPrompt = event;
        dom.installButton.style.display = "inline-flex";
    });

    dom.installButton.addEventListener("click", async () => {
        if (!deferredPrompt) {
            return;
        }

        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        dom.installButton.style.display = "none";
    });

    window.addEventListener("appinstalled", () => {
        dom.installButton.style.display = "none";
    });
}

function readStorage(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch (err) {
        return fallback;
    }
}

function writeStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function truncateText(text, maxLength) {
    const cleanText = String(text || "").replace(/\s+/g, " ").trim();
    return cleanText.length <= maxLength ? cleanText : `${cleanText.slice(0, maxLength - 1).trim()}...`;
}

function capitalizeWords(text) {
    return String(text || "").split(" ").map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : "").join(" ");
}

function formatArchiveDate(isoString) {
    try {
        return new Date(isoString).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (err) {
        return isoString;
    }
}

function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getMicErrorMessage(err) {
    if (!err) {
        return "Microphone error.";
    }

    switch (err.name) {
        case "NotAllowedError":
        case "PermissionDeniedError":
        case "SecurityError":
            return "Microphone permission denied. Allow microphone access and try again.";
        case "NotFoundError":
        case "DevicesNotFoundError":
            return "No microphone was found. Connect a microphone and try again.";
        case "NotReadableError":
        case "TrackStartError":
            return "The microphone is already in use by another app or cannot be accessed.";
        default:
            return `Mic error: ${err.message || err.name || "Unknown error"}`;
    }
}
