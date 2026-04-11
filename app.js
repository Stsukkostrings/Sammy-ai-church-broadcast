/*
 OmniCast AI
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
let mediaRecorder = null;
let recordingChunks = [];
let recordingUrl = "";
let recordingMimeType = "";

const STORAGE_KEYS = {
    archive: "omnicast_archive_sessions_v2",
    planner: "omnicast_planner_progress_v2",
    liveOverlay: "omnicast_live_overlay_v1"
};

const BIBLE_DICTIONARY = {
    covenant: "A covenant is a binding promise that defines relationship and responsibility. In Scripture, God uses covenants to reveal His faithfulness to His people.",
    grace: "Grace is God's undeserved favor and empowering kindness. It is central to salvation and the believer's daily walk with Christ.",
    tabernacle: "The tabernacle was Israel's mobile place of worship in the wilderness, symbolizing God's holy presence among His people.",
    justification: "Justification is God's declaration that a sinner is righteous through faith in Jesus Christ, not by human works.",
    sanctification: "Sanctification is the ongoing work of God that shapes believers into Christlike holiness through the Spirit.",
    redemption: "Redemption means deliverance by payment of a price. In the gospel, Christ redeems people from sin through His sacrifice.",
    passover: "Passover remembers God's deliverance of Israel from Egypt and points forward to Jesus Christ as the Lamb who saves.",
    disciple: "A disciple is a learner and follower of Jesus who is being formed by His teaching, character, and mission.",
    gospel: "The gospel is the good news that Jesus lived, died, rose again, and offers forgiveness and new life to all who believe.",
    kingdom: "The kingdom of God is God's reign and rule, revealed in Jesus and advancing through His people until its full completion."
};

const HEBREW_WORDS = [
    { term: "shalom", transliteration: "sha-LOHM", meaning: "peace, wholeness, well-being", note: "Used for peace that includes harmony, safety, and completeness." },
    { term: "hesed", transliteration: "HEH-sed", meaning: "steadfast love, covenant mercy", note: "Describes God's loyal, enduring love toward His people." },
    { term: "ruach", transliteration: "roo-AKH", meaning: "spirit, breath, wind", note: "Often used for breath, wind, or the Spirit of God." },
    { term: "bara", transliteration: "bah-RAH", meaning: "to create", note: "Commonly used in Genesis 1 to describe God's creative act." },
    { term: "hallelujah", transliteration: "hal-le-loo-YAH", meaning: "praise Yahweh", note: "A call to worship and praise the Lord." },
    { term: "emunah", transliteration: "eh-moo-NAH", meaning: "faithfulness, steadfastness", note: "Carries the idea of firmness, reliability, and faithful trust." },
    { term: "adonai", transliteration: "ah-doe-NYE", meaning: "Lord, Master", note: "A reverent title used in place of the divine name." },
    { term: "torah", transliteration: "toe-RAH", meaning: "instruction, law", note: "Refers to God's teaching, especially the first books of Scripture." },
    { term: "mashiach", transliteration: "mah-SHEE-akh", meaning: "anointed one, messiah", note: "The title pointing to the promised deliverer." },
    { term: "amen", transliteration: "ah-MEN", meaning: "truly, so be it", note: "A spoken agreement affirming truth and confidence." }
];

const DEFAULT_PLANNER = [
    { id: "welcome-loop", title: "Welcome Loop + Opening Lower Third", role: "Media Desk", time: "08:45" },
    { id: "worship-set", title: "Worship Set Graphics", role: "Lyrics Operator", time: "09:00" },
    { id: "session-capture", title: "Live Session Capture + Notes", role: "Broadcast Lead", time: "09:35" },
    { id: "response-screen", title: "Response Screen + Overlay", role: "Stage Display", time: "10:20" },
    { id: "announcements", title: "Announcements + Outro", role: "Media Desk", time: "10:35" }
];

const state = {
    session: { id: "guest", fullName: "OmniCast Team", email: "" },
    sessionNotes: [],
    references: [],
    currentReference: "",
    currentVerseText: "",
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
    currentReference: document.getElementById("currentReference"),
    obsOverlayUrl: document.getElementById("obsOverlayUrl"),
    copyObsUrlButton: document.getElementById("copyObsUrlButton"),
    openObsOverlayLink: document.getElementById("openObsOverlayLink"),
    downloadButton: document.getElementById("downloadButton"),
    shareButton: document.getElementById("shareButton"),
    installButton: document.getElementById("installBtn"),
    dictionaryInput: document.getElementById("dictionaryInput"),
    dictionaryButton: document.getElementById("dictionaryButton"),
    dictionaryResult: document.getElementById("dictionaryResult"),
    hebrewInput: document.getElementById("hebrewInput"),
    hebrewButton: document.getElementById("hebrewButton"),
    hebrewResult: document.getElementById("hebrewResult"),
    recordButton: document.getElementById("recordButton"),
    downloadAudioButton: document.getElementById("downloadAudioButton"),
    recordingStatus: document.getElementById("recordingStatus"),
    recordingPlayback: document.getElementById("recordingPlayback"),
    mediaLinkInput: document.getElementById("mediaLinkInput"),
    socialCaptionInput: document.getElementById("socialCaptionInput"),
    fillCaptionButton: document.getElementById("fillCaptionButton"),
    copyCaptionButton: document.getElementById("copyCaptionButton"),
    shareFacebookButton: document.getElementById("shareFacebookButton"),
    shareXButton: document.getElementById("shareXButton"),
    shareLinkedInButton: document.getElementById("shareLinkedInButton"),
    shareWhatsAppButton: document.getElementById("shareWhatsAppButton"),
    shareTelegramButton: document.getElementById("shareTelegramButton"),
    publishStatus: document.getElementById("publishStatus")
};

const canvasContext = dom.canvas ? dom.canvas.getContext("2d") : null;
const obs = typeof OBSWebSocket !== "undefined" ? new OBSWebSocket() : null;
let lastFetchedReference = "";

init();

function init() {
    setupPwaInstall();

    if (!dom.appRoot) {
        return;
    }

    bindWorkspace();
    renderPlanner();
    renderArchive();
    syncNotesFromTextarea();
    renderObsOverlayUrl();
    setWorkspaceHeading();
    refreshWorkspace();
    connectOBS();
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
    dom.copyObsUrlButton?.addEventListener("click", copyObsOverlayUrl);
    dom.sessionTitle?.addEventListener("input", updateGeneratedContent);
    dom.dictionaryButton?.addEventListener("click", searchDictionary);
    dom.hebrewButton?.addEventListener("click", searchHebrewWord);
    dom.recordButton?.addEventListener("click", toggleRecording);
    dom.downloadAudioButton?.addEventListener("click", downloadRecording);

    dom.fillCaptionButton?.addEventListener("click", fillSocialCaption);
    dom.copyCaptionButton?.addEventListener("click", copySocialCaption);
    dom.shareFacebookButton?.addEventListener("click", () => shareToPlatform("facebook"));
    dom.shareXButton?.addEventListener("click", () => shareToPlatform("x"));
    dom.shareLinkedInButton?.addEventListener("click", () => shareToPlatform("linkedin"));
    dom.shareWhatsAppButton?.addEventListener("click", () => shareToPlatform("whatsapp"));
    dom.shareTelegramButton?.addEventListener("click", () => shareToPlatform("telegram"));

    dom.notesBox?.addEventListener("input", () => {
        syncNotesFromTextarea();
        updateGeneratedContent();
    });

    dom.dictionaryInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchDictionary();
        }
    });

    dom.hebrewInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchHebrewWord();
        }
    });
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
            scanLiveReference(transcript);
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
        micStream = await getOrCreateMicStream();

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

    if (!mediaRecorder || mediaRecorder.state === "inactive") {
        releaseMicStream();
    }

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

    if (canvasContext && dom.canvas) {
        canvasContext.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
    }

    if (dom.speechHint) {
        dom.speechHint.textContent = "Listening paused.";
    }

    if (dom.listenButton) {
        dom.listenButton.textContent = "Start Listening";
    }
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
        if (dom.speechHint) {
            dom.speechHint.textContent = "Mic is active, but speech recognition is not supported on this device.";
        }
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

        if (dom.speechText) {
            dom.speechText.textContent = (interimText || finalText || "Waiting...").trim();
        }
        if (dom.speechHint) {
            dom.speechHint.textContent = "Listening... waiting for the next phrase.";
        }
        scanLiveReference(interimText || finalText);
    };

    recognition.onerror = (event) => {
        if (dom.speechHint) {
            dom.speechHint.textContent = event.error || "Speech recognition failed.";
        }
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
    state.sessionNotes.push(`[${time}] ${cleanText}`);

    if (dom.notesBox) {
        dom.notesBox.value = state.sessionNotes.join("\n");
    }

    detectBible(cleanText);
    updateGeneratedContent();
}

function clearNotes() {
    state.sessionNotes = [];
    state.references = [];
    state.currentReference = "";
    state.currentVerseText = "";
    lastFetchedReference = "";

    if (dom.notesBox) {
        dom.notesBox.value = "";
    }
    if (dom.overlayText) {
        dom.overlayText.textContent = "Fetched scripture will appear here for display.";
    }
    if (dom.dictionaryResult) {
        dom.dictionaryResult.textContent = "Search a Bible term to see a quick explanation.";
    }
    if (dom.hebrewResult) {
        dom.hebrewResult.textContent = "Search a Hebrew word or English meaning to view transliteration and translation.";
    }
    if (dom.currentReference) {
        dom.currentReference.textContent = "none yet";
    }

    broadcastOverlay("", "");
    updateGeneratedContent();
}

function syncNotesFromTextarea() {
    if (!dom.notesBox) {
        return;
    }

    state.sessionNotes = dom.notesBox.value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    rebuildDetectedReferences();
}

function detectBible(text) {
    extractReferences(text).forEach((reference) => {
        if (!state.references.includes(reference)) {
            state.references.push(reference);
        }
        triggerLiveReference(reference);
    });

    renderReferences();
}

function rebuildDetectedReferences() {
    state.references = [];
    state.sessionNotes.forEach((line) => detectBible(line));
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
        const verseText = payload?.text ? payload.text.trim() : "Verse not found.";

        state.currentReference = reference;
        state.currentVerseText = verseText;

        if (dom.overlayText) {
            dom.overlayText.textContent = verseText;
        }
        if (dom.currentReference) {
            dom.currentReference.textContent = reference;
        }

        broadcastOverlay(reference, payload?.text ? verseText : "");

        if (payload?.text) {
            await sendToOBS(verseText);
        }
    } catch (err) {
        if (dom.overlayText) {
            dom.overlayText.textContent = "Error fetching verse.";
        }
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
    const reference = dom.verseInput?.value.trim();
    if (!reference) {
        alert("Type a Bible reference first.");
        return;
    }

    fetchVerse(reference);
}

function scanLiveReference(text) {
    const references = extractReferences(text);
    if (references.length) {
        triggerLiveReference(references[references.length - 1]);
    }
}

function triggerLiveReference(reference) {
    if (!reference || reference === lastFetchedReference) {
        return;
    }

    lastFetchedReference = reference;
    if (dom.verseInput) {
        dom.verseInput.value = reference;
    }
    fetchVerse(reference);
}

function extractReferences(text) {
    const references = [];
    const regex = /\b((?:[1-3]\s)?(?:[A-Za-z]+(?:\s+[A-Za-z]+){0,2}))\s+(\d+):(\d+)\b/gi;
    let match;

    while ((match = regex.exec(String(text || ""))) !== null) {
        let book = match[1].toLowerCase().replace(/\s+/g, " ").trim();
        if (book === "mathew") {
            book = "matthew";
        }
        if (book === "johnn") {
            book = "john";
        }

        references.push(`${capitalizeWords(book)} ${match[2]}:${match[3]}`);
    }

    return references;
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
    if (!state.sessionNotes.length) {
        return "Start listening or type session notes to generate a summary.";
    }

    const joined = state.sessionNotes.join(" ").replace(/\[[^\]]+\]\s*/g, "");
    const lower = joined.toLowerCase();
    const themeWords = ["faith", "grace", "hope", "love", "worship", "jesus", "truth", "church", "prayer", "spirit"];
    const themes = themeWords.filter((word) => lower.includes(word));
    const title = dom.sessionTitle?.value.trim() || "Untitled Session";
    const preview = truncateText(joined, 180);
    const themeText = themes.length ? ` Key themes: ${themes.slice(0, 4).join(", ")}.` : "";

    return `${title}: ${preview}.${themeText}`;
}

function generatePromo(summary) {
    const emptyMessage = "Start listening or type session notes to generate a summary.";
    const base = summary === emptyMessage ? summary : summary.replace(/^.*?:\s*/, "");
    return `Here is a concise highlight from this live session. Key takeaway: ${truncateText(base, 160)}`;
}

function archiveCurrentSession() {
    syncNotesFromTextarea();

    if (!state.sessionNotes.length) {
        alert("Add session notes before archiving a session.");
        return;
    }

    state.archive.unshift({
        id: Date.now(),
        title: dom.sessionTitle?.value.trim() || "Untitled Session",
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

    if (dom.archiveCount) {
        dom.archiveCount.textContent = String(state.archive.length);
    }

    if (!state.archive.length) {
        dom.archiveList.innerHTML = '<div class="archive-empty"><strong>Archive Empty</strong><p>Save a session from Overview to populate your history.</p></div>';
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
    updateGeneratedContent();
    renderArchive();
    refreshPlannerStats();
    refreshMicUi(micStream || recognition || usingNativeSpeech ? "Listening" : "Mic status");
    refreshRecordingUi();
    setWorkspaceHeading();
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

    if (!state.sessionNotes.length) {
        alert("No notes to download.");
        return;
    }

    const blob = new Blob([state.sessionNotes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "session_notes.txt";
    link.click();
    URL.revokeObjectURL(url);
}

function searchDictionary() {
    const query = normalizeLookup(dom.dictionaryInput?.value);
    if (!query) {
        if (dom.dictionaryResult) {
            dom.dictionaryResult.textContent = "Type a Bible term like grace, covenant, or redemption.";
        }
        return;
    }

    const entry = Object.entries(BIBLE_DICTIONARY).find(([term]) => term.includes(query) || query.includes(term));
    if (!dom.dictionaryResult) {
        return;
    }

    if (!entry) {
        dom.dictionaryResult.textContent = `No local dictionary entry for "${query}" yet. Try grace, covenant, disciple, gospel, or tabernacle.`;
        return;
    }

    dom.dictionaryResult.innerHTML = `<strong>${capitalizeWords(entry[0])}</strong><p>${escapeHtml(entry[1])}</p>`;
}

function searchHebrewWord() {
    const query = normalizeLookup(dom.hebrewInput?.value);
    if (!query) {
        if (dom.hebrewResult) {
            dom.hebrewResult.textContent = "Type a Hebrew word like shalom, hesed, or ruach.";
        }
        return;
    }

    const match = HEBREW_WORDS.find((entry) => (
        entry.term.includes(query) ||
        entry.meaning.includes(query) ||
        entry.note.toLowerCase().includes(query)
    ));

    if (!dom.hebrewResult) {
        return;
    }

    if (!match) {
        dom.hebrewResult.textContent = `No local Hebrew entry for "${query}" yet. Try shalom, hesed, ruach, torah, or mashiach.`;
        return;
    }

    dom.hebrewResult.innerHTML = `
        <strong>${escapeHtml(match.term)}</strong>
        <p><strong>Transliteration:</strong> ${escapeHtml(match.transliteration)}</p>
        <p><strong>Meaning:</strong> ${escapeHtml(match.meaning)}</p>
        <p>${escapeHtml(match.note)}</p>
    `;
}

async function toggleRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        stopRecording();
        return;
    }

    await startRecording();
}

async function startRecording() {
    if (!window.MediaRecorder) {
        alert("Audio recording is not supported in this browser.");
        return;
    }

    try {
        const stream = await getOrCreateMicStream();
        const mimeType = getSupportedRecordingMimeType();
        recordingChunks = [];
        mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        recordingMimeType = mediaRecorder.mimeType || mimeType || "audio/webm";

        mediaRecorder.addEventListener("dataavailable", (event) => {
            if (event.data && event.data.size > 0) {
                recordingChunks.push(event.data);
            }
        });

        mediaRecorder.addEventListener("stop", handleRecordingStop);
        mediaRecorder.start();
        refreshRecordingUi();
    } catch (err) {
        alert(getMicErrorMessage(err));
        refreshRecordingUi();
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
    }
}

function handleRecordingStop() {
    const mimeType = recordingMimeType || mediaRecorder?.mimeType || "audio/webm";
    const blob = new Blob(recordingChunks, { type: mimeType });

    if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl);
    }

    recordingUrl = URL.createObjectURL(blob);

    if (dom.recordingPlayback) {
        dom.recordingPlayback.src = recordingUrl;
    }

    mediaRecorder = null;
    recordingChunks = [];

    if (!recognition && !usingNativeSpeech) {
        releaseMicStream();
    }

    refreshRecordingUi();
}

function downloadRecording() {
    if (!recordingUrl) {
        alert("Record an audio clip first.");
        return;
    }

    const link = document.createElement("a");
    link.href = recordingUrl;
    link.download = `${slugify(dom.sessionTitle?.value || "session-recording")}.${getRecordingFileExtension()}`;
    link.click();
}

function refreshRecordingUi() {
    const isRecording = !!mediaRecorder && mediaRecorder.state === "recording";

    if (dom.recordButton) {
        dom.recordButton.textContent = isRecording ? "Stop Recording" : "Start Recording";
    }

    if (dom.downloadAudioButton) {
        dom.downloadAudioButton.disabled = !recordingUrl;
    }

    if (dom.recordingStatus) {
        dom.recordingStatus.textContent = isRecording ? "Recording in progress" : (recordingUrl ? "Audio ready to download" : "Ready to record");
    }
}

async function shareNotes() {
    syncNotesFromTextarea();

    if (!state.sessionNotes.length) {
        alert("No notes to share.");
        return;
    }

    const payload = {
        title: dom.sessionTitle?.value.trim() || "Live Session",
        text: state.sessionNotes.join("\n")
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

function getObsOverlayUrl() {
    return new URL("lower-third.html", window.location.href).toString();
}

function renderObsOverlayUrl() {
    const url = getObsOverlayUrl();
    if (dom.obsOverlayUrl) {
        dom.obsOverlayUrl.textContent = url;
    }
    if (dom.openObsOverlayLink) {
        dom.openObsOverlayLink.href = url;
    }
}

async function copyObsOverlayUrl() {
    const url = getObsOverlayUrl();

    try {
        await navigator.clipboard.writeText(url);
        if (dom.copyObsUrlButton) {
            const originalText = dom.copyObsUrlButton.textContent;
            dom.copyObsUrlButton.textContent = "Copied";
            setTimeout(() => {
                dom.copyObsUrlButton.textContent = originalText;
            }, 1600);
        }
    } catch (err) {
        alert(`Copy this OBS Browser Source URL:\n${url}`);
    }
}

function broadcastOverlay(reference, text) {
    writeStorage(STORAGE_KEYS.liveOverlay, {
        reference,
        text,
        updatedAt: new Date().toISOString()
    });
}

function setWorkspaceHeading() {
    if (dom.workspaceGreeting) {
        dom.workspaceGreeting.textContent = "Welcome to OmniCast Studio";
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

async function getOrCreateMicStream() {
    if (micStream) {
        return micStream;
    }

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

    return micStream;
}

function releaseMicStream() {
    micStream?.getTracks().forEach((track) => track.stop());
    micStream = null;
}

function fillSocialCaption() {
    const promo = dom.promoSnippet?.textContent?.trim() || "";
    const summary = dom.summaryText?.textContent?.trim() || "";
    const title = dom.sessionTitle?.value?.trim() || "Untitled Session";
    const nextCaption = promo || `${title}\n\n${summary}`.trim();

    if (dom.socialCaptionInput) {
        dom.socialCaptionInput.value = nextCaption;
    }

    setPublishStatus("Caption updated from generated content.");
}

async function copySocialCaption() {
    const caption = getSocialCaption();
    if (!caption) {
        setPublishStatus("Add or generate a caption first.");
        return;
    }

    try {
        await navigator.clipboard.writeText(caption);
        setPublishStatus("Caption copied to clipboard.");
    } catch (err) {
        setPublishStatus("Unable to copy caption on this device.");
    }
}

function getSocialCaption() {
    return String(dom.socialCaptionInput?.value || "").trim();
}

function getMediaLink() {
    return String(dom.mediaLinkInput?.value || "").trim();
}

function setPublishStatus(message) {
    if (dom.publishStatus) {
        dom.publishStatus.textContent = message;
    }
}

function shareToPlatform(platform) {
    const caption = getSocialCaption();
    const mediaLink = getMediaLink();

    if (!caption && !mediaLink) {
        setPublishStatus("Add a caption or media link before sharing.");
        return;
    }

    const shareText = [caption, mediaLink].filter(Boolean).join("\n\n");
    let shareUrl = "";

    switch (platform) {
        case "facebook":
            if (!mediaLink) {
                setPublishStatus("Facebook sharing needs a media or page URL.");
                return;
            }
            shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(mediaLink)}`;
            break;
        case "x":
            shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}${mediaLink ? `&url=${encodeURIComponent(mediaLink)}` : ""}`;
            break;
        case "linkedin":
            if (!mediaLink) {
                setPublishStatus("LinkedIn sharing needs a media or page URL.");
                return;
            }
            shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(mediaLink)}`;
            break;
        case "whatsapp":
            shareUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
            break;
        case "telegram":
            shareUrl = `https://t.me/share/url?url=${encodeURIComponent(mediaLink || window.location.href)}&text=${encodeURIComponent(caption)}`;
            break;
        default:
            setPublishStatus("Unsupported platform selected.");
            return;
    }

    window.open(shareUrl, "_blank", "noopener,noreferrer");
    setPublishStatus(`Opened ${capitalizeWords(platform)} sharing window.`);
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
    return String(text || "")
        .split(" ")
        .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : ""))
        .join(" ");
}

function normalizeLookup(text) {
    return String(text || "").trim().toLowerCase();
}

function slugify(text) {
    const clean = String(text || "session-recording")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return clean || "session-recording";
}

function getSupportedRecordingMimeType() {
    if (!window.MediaRecorder?.isTypeSupported) {
        return "";
    }

    const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    return options.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function getRecordingFileExtension() {
    const mimeType = recordingMimeType || mediaRecorder?.mimeType || "";
    if (mimeType.includes("mp4")) {
        return "mp4";
    }
    if (mimeType.includes("ogg")) {
        return "ogg";
    }
    return "webm";
}

function formatArchiveDate(isoString) {
    try {
        return new Date(isoString).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
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
