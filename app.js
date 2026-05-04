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
let listeningActive = false;
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
    liveOverlay: "omnicast_live_overlay_v1",
    verseCache: "omnicast_verse_cache_v1"
};

const DISPLAY_DURATION_MS = 40000;

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

const ENGLISH_DICTIONARY_FALLBACK = {
    broadcast: "To transmit audio or video content to an audience by radio, television, or the internet.",
    studio: "A room or workspace equipped for recording, broadcasting, design, or creative production.",
    archive: "A collection of records preserved for future reference.",
    sermon: "A spoken religious address, usually based on scripture and delivered to a congregation.",
    worship: "The act of showing reverence, honor, or devotion."
};

const BIBLE_BOOKS = new Set([
    "genesis", "exodus", "leviticus", "numbers", "deuteronomy", "joshua", "judges", "ruth",
    "1 samuel", "2 samuel", "1 kings", "2 kings", "1 chronicles", "2 chronicles", "ezra", "nehemiah", "esther",
    "job", "psalms", "psalm", "proverbs", "ecclesiastes", "song of solomon", "song of songs", "isaiah", "jeremiah",
    "lamentations", "ezekiel", "daniel", "hosea", "joel", "amos", "obadiah", "jonah", "micah", "nahum", "habakkuk",
    "zephaniah", "haggai", "zechariah", "malachi", "matthew", "mark", "luke", "john", "acts", "romans",
    "1 corinthians", "2 corinthians", "galatians", "ephesians", "philippians", "colossians", "1 thessalonians",
    "2 thessalonians", "1 timothy", "2 timothy", "titus", "philemon", "hebrews", "james", "1 peter", "2 peter",
    "1 john", "2 john", "3 john", "jude", "revelation"
]);

const BIBLE_BOOK_PATTERN = Array.from(BIBLE_BOOKS)
    .sort((a, b) => b.length - a.length)
    .map((book) => book.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

const NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90
};

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
    plannerDone: readStorage(STORAGE_KEYS.planner, []),
    verseCache: readStorage(STORAGE_KEYS.verseCache, {})
};

const pagePath = window.location.pathname || "";
const isChurchStudioPage = pagePath.endsWith("/church_studio.html");

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
    previewReference: document.getElementById("previewReference"),
    previewText: document.getElementById("previewText"),
    liveVisibilityButton: document.getElementById("liveVisibilityButton"),
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
const obs = createObsClient();
const liveOverlayChannel = createLiveOverlayChannel();
let lastFetchedReference = "";
let displayClearTimer = null;
let displayClearToken = 0;

function createLiveOverlayChannel() {
    try {
        return typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(STORAGE_KEYS.liveOverlay) : null;
    } catch (err) {
        return null;
    }
}

function createObsClient() {
    try {
        return typeof OBSWebSocket !== "undefined" ? new OBSWebSocket() : null;
    } catch (err) {
        console.warn("OBS client unavailable:", err);
        return null;
    }
}

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
        if (listeningActive) {
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
    dom.plannerList?.addEventListener("click", (event) => {
        const button = event.target.closest(".planner-toggle");
        if (!button) {
            return;
        }
        togglePlanner(button.dataset.plannerId);
    });

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
            processRecognizedSpeech(transcript, false);
        }
    });

    await plugin.addListener("finalResults", (event) => {
        const transcript = firstTranscript(event.matches);
        if (!transcript) {
            return;
        }

        saveNote(transcript);
        dom.speechText.textContent = transcript;
        processRecognizedSpeech(transcript, true);
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
        listeningActive = true;
        refreshMicUi("Listening");
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
        drawWave();
        await startSpeech();
    } catch (err) {
        await resetMicSession();
        showMicError(err);
    }
}

async function stopMic() {
    speechStoppedManually = true;
    listeningActive = false;

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

    refreshMicUi("Mic status");
}

async function resetMicSession() {
    speechStoppedManually = true;
    listeningActive = false;
    recognition = null;
    usingNativeSpeech = false;

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
    releaseMicStream();
}

function showMicError(err) {
    const message = getMicErrorMessage(err);

    if (dom.speechHint) {
        dom.speechHint.textContent = message;
    }
    if (dom.speechText) {
        dom.speechText.textContent = "Waiting for transcription...";
    }

    refreshMicUi("Mic not connected");
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
                processRecognizedSpeech(transcript, true);
            } else {
                interimText += `${transcript} `;
                processRecognizedSpeech(transcript, false);
            }
        }

        if (dom.speechText) {
            dom.speechText.textContent = (interimText || finalText || "Waiting...").trim();
        }
        if (dom.speechHint) {
            dom.speechHint.textContent = "Listening... waiting for the next phrase.";
        }
        scanLiveReference(`${finalText} ${interimText}`);
    };

    recognition.onerror = (event) => {
        listeningActive = false;
        if (dom.speechHint) {
            dom.speechHint.textContent = event.error || "Speech recognition failed.";
        }
        refreshMicUi("Mic status");
    };

    recognition.onend = () => {
        if (!speechStoppedManually && listeningActive) {
            try {
                recognition.start();
            } catch (err) {
                listeningActive = false;
                refreshMicUi("Mic status");
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
    cancelDisplayClearTimer();

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

    updateChurchPreview("", "");
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
    const requestedReference = normalizeReference(reference);
    if (!requestedReference) {
        updateChurchPreview("", "", "Type or speak a Bible reference first.");
        return;
    }

    updateChurchPreview(requestedReference, "", "Loading scripture...");
    const cacheKey = getVerseCacheKey(requestedReference);
    const cachedVerse = state.verseCache[cacheKey];
    if (cachedVerse?.text) {
        displayFetchedVerse(cachedVerse.reference || requestedReference, cachedVerse.text, true);
        return;
    }

    try {
        const response = await fetch(`https://bible-api.com/${encodeURIComponent(requestedReference)}`);
        const payload = await response.json();
        const verseText = payload?.text ? payload.text.trim() : "Verse not found.";
        const resolvedReference = payload?.reference || requestedReference;

        if (payload?.text) {
            state.verseCache[cacheKey] = {
                reference: resolvedReference,
                text: verseText,
                cachedAt: new Date().toISOString()
            };
            writeStorage(STORAGE_KEYS.verseCache, state.verseCache);
        }

        displayFetchedVerse(resolvedReference, verseText, !!payload?.text);

        if (payload?.text) {
            await sendToOBS(verseText);
        }
    } catch (err) {
        if (dom.overlayText) {
            dom.overlayText.textContent = "Error fetching verse.";
        }
        updateChurchPreview(requestedReference, "Error fetching verse.");
    }
}

function displayFetchedVerse(reference, verseText, shouldAutoClear) {
    state.currentReference = reference;
    state.currentVerseText = verseText;

    if (dom.overlayText) {
        dom.overlayText.textContent = verseText;
    }
    if (dom.currentReference) {
        dom.currentReference.textContent = reference;
    }

    updateChurchPreview(reference, verseText);
    broadcastOverlay(reference, verseText);

    if (isChurchStudioPage && shouldAutoClear) {
        scheduleDisplayClear(reference);
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
    const reference = normalizeReference(dom.verseInput?.value || document.getElementById("chapterSearchInput")?.value);
    if (!reference) {
        updateChurchPreview("", "", "Type or speak a Bible reference first.");
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

function processRecognizedSpeech(text, isFinal) {
    const transcript = String(text || "").trim();
    if (!transcript) {
        return;
    }

    const references = extractReferences(transcript);
    if (!references.length) {
        return;
    }

    const reference = references[references.length - 1];
    if (!state.references.includes(reference)) {
        state.references.push(reference);
        renderReferences();
    }

    if (dom.speechHint) {
        dom.speechHint.textContent = `Detected ${reference}${isFinal ? "" : " from live speech"}.`;
    }

    triggerLiveReference(reference);
}

function triggerLiveReference(reference) {
    if (!reference || reference === lastFetchedReference) {
        return;
    }

    lastFetchedReference = reference;
    if (dom.verseInput) {
        dom.verseInput.value = reference;
    }
    if (isChurchStudioPage) {
        broadcastOverlay(state.currentReference, state.currentVerseText);
    }
    fetchVerse(reference);
}

function normalizeReference(reference) {
    return String(reference || "").trim().replace(/\s+/g, " ");
}

function getVerseCacheKey(reference) {
    return normalizeReference(reference).toLowerCase();
}

function updateChurchPreview(reference, text, fallbackText) {
    if (!isChurchStudioPage) {
        return;
    }

    const cleanReference = normalizeReference(reference);
    const cleanText = String(text || "").trim();
    const previewText = cleanText || fallbackText || "Search for a verse to see it here first";

    if (dom.previewReference) {
        dom.previewReference.textContent = cleanReference || "Ready to preview";
    }
    if (dom.previewText) {
        dom.previewText.textContent = previewText;
    }
    if (dom.currentReference) {
        dom.currentReference.textContent = cleanReference || "none yet";
    }
    if (dom.overlayText) {
        dom.overlayText.textContent = cleanText || fallbackText || "Fetched scripture will appear here for display.";
    }
    if (dom.verseInput && cleanReference) {
        dom.verseInput.value = cleanReference;
    }
    if (cleanReference && !state.references.includes(cleanReference)) {
        state.references.push(cleanReference);
        renderReferences();
    }

    broadcastOverlay(cleanReference, cleanText);
}

function scheduleDisplayClear(reference) {
    cancelDisplayClearTimer();
    const token = ++displayClearToken;
    const expectedReference = normalizeReference(reference);

    displayClearTimer = setTimeout(() => {
        if (token !== displayClearToken) {
            return;
        }
        clearDisplayedVerse(expectedReference);
    }, DISPLAY_DURATION_MS);
}

function cancelDisplayClearTimer() {
    if (displayClearTimer) {
        clearTimeout(displayClearTimer);
        displayClearTimer = null;
    }
    displayClearToken += 1;
}

function clearDisplayedVerse(expectedReference) {
    if (!isChurchStudioPage) {
        return;
    }

    if (expectedReference && normalizeReference(state.currentReference) !== expectedReference) {
        return;
    }

    state.currentReference = "";
    state.currentVerseText = "";
    lastFetchedReference = "";
    updateChurchPreview("", "");
    broadcastOverlay("", "");
}

function toggleChurchLivePreview() {
    if (!isChurchStudioPage || !dom.liveVisibilityButton) {
        return;
    }

    const isLive = dom.liveVisibilityButton.textContent.trim().toLowerCase() !== "live";
    setChurchLiveState(isLive);
    broadcastOverlay(state.currentReference, state.currentVerseText);
}

function setChurchLiveState(isLive) {
    if (!isChurchStudioPage || !dom.liveVisibilityButton) {
        return;
    }

    dom.liveVisibilityButton.textContent = isLive ? "LIVE" : "HIDDEN";
    dom.liveVisibilityButton.classList.toggle("is-live", isLive);
    dom.liveVisibilityButton.setAttribute("aria-pressed", String(isLive));
}

function extractReferences(text) {
    const references = [];
    const source = String(text || "");
    const regex = /\b((?:[1-3]\s)?(?:[A-Za-z]+(?:\s+[A-Za-z]+){0,2}))\s+(\d+):(\d+)\b/gi;
    let match;

    while ((match = regex.exec(source)) !== null) {
        addReference(references, match[1], match[2], match[3]);
    }

    const numberToken = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\\s](?:one|two|three|four|five|six|seven|eight|nine))?";
    const spokenRegex = new RegExp(`\\b(?:book\\s+of\\s+)?(${BIBLE_BOOK_PATTERN})\\s+(?:chapter\\s+|chapter\\s+number\\s+)?(${numberToken})\\s+(?:verse\\s+|verses\\s+|verse\\s+number\\s+|colon\\s+)(${numberToken})\\b`, "gi");

    while ((match = spokenRegex.exec(source)) !== null) {
        addReference(references, match[1], parseSpokenNumber(match[2]), parseSpokenNumber(match[3]));
    }

    const compactSpeechRegex = new RegExp(`\\b(?:book\\s+of\\s+)?(${BIBLE_BOOK_PATTERN})\\s+(${numberToken})\\s+(${numberToken})\\b`, "gi");

    while ((match = compactSpeechRegex.exec(source)) !== null) {
        addReference(references, match[1], parseSpokenNumber(match[2]), parseSpokenNumber(match[3]));
    }

    const compactDigitRegex = new RegExp(`\\b(?:book\\s+of\\s+)?(${BIBLE_BOOK_PATTERN})\\s+(\\d{3,4})\\b`, "gi");

    while ((match = compactDigitRegex.exec(source)) !== null) {
        const digits = match[2];
        addReference(references, match[1], digits.slice(0, -2), digits.slice(-2));
    }

    return references;
}

function addReference(references, bookText, chapter, verse) {
    const book = normalizeBibleBook(bookText);
    const chapterNumber = Number(chapter);
    const verseNumber = Number(verse);

    if (!book || !chapterNumber || !verseNumber) {
        return;
    }

    const reference = `${capitalizeWords(book)} ${chapterNumber}:${verseNumber}`;
    if (!references.includes(reference)) {
        references.push(reference);
    }
}

function normalizeBibleBook(bookText) {
    let book = String(bookText || "").toLowerCase().replace(/\s+/g, " ").trim();
    const replacements = {
        mathew: "matthew",
        johnn: "john",
        revelation: "revelation",
        revelations: "revelation",
        psalm: "psalm",
        psalms: "psalms"
    };

    book = replacements[book] || book;
    return BIBLE_BOOKS.has(book) ? book : "";
}

function parseSpokenNumber(value) {
    if (value === null || value === undefined) {
        return 0;
    }

    const raw = String(value).toLowerCase().replace(/-/g, " ").trim();
    if (/^\d+$/.test(raw)) {
        return Number(raw);
    }

    return raw.split(/\s+/).reduce((total, part) => total + (NUMBER_WORDS[part] || 0), 0);
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

    dom.plannerList.dataset.ready = "true";

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
    refreshMicUi(listeningActive ? "Listening" : "Mic status");
    refreshSpeechIdleUi();
    refreshRecordingUi();
    setWorkspaceHeading();
}

function refreshSpeechIdleUi() {
    if (listeningActive) {
        return;
    }

    if (dom.speechHint) {
        dom.speechHint.textContent = "Listening paused.";
    }

    if (dom.speechText && /microphone unavailable|mic unavailable|no microphone/i.test(dom.speechText.textContent || "")) {
        dom.speechText.textContent = "Waiting for transcription...";
    }
}

function refreshMicUi(statusText) {
    if (dom.micStatus) {
        dom.micStatus.textContent = statusText;
    }
    if (dom.listenButton) {
        const label = listeningActive ? "Stop Listening" : "Start Listening";
        if (isChurchStudioPage) {
            dom.listenButton.setAttribute("aria-label", label);
            dom.listenButton.title = label;
        } else {
            dom.listenButton.textContent = label;
        }
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

async function searchDictionary() {
    if (isChurchStudioPage) {
        searchBibleDictionary();
        return;
    }

    await searchEnglishDictionary();
}

function searchBibleDictionary() {
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

async function searchEnglishDictionary() {
    const query = normalizeLookup(dom.dictionaryInput?.value);
    if (!query) {
        if (dom.dictionaryResult) {
            dom.dictionaryResult.textContent = "Type any English word to look up its meaning.";
        }
        return;
    }

    if (!dom.dictionaryResult) {
        return;
    }

    dom.dictionaryResult.textContent = "Looking up definition...";

    try {
        const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`);
        if (!response.ok) {
            throw new Error("Definition not found.");
        }

        const payload = await response.json();
        const entry = Array.isArray(payload) ? payload[0] : null;
        const phonetic = entry?.phonetic || entry?.phonetics?.find((item) => item.text)?.text || "";
        const meanings = (entry?.meanings || [])
            .flatMap((meaning) => (meaning.definitions || []).slice(0, 2).map((definition) => ({
                partOfSpeech: meaning.partOfSpeech,
                definition: definition.definition,
                example: definition.example
            })))
            .slice(0, 4);

        if (!meanings.length) {
            throw new Error("Definition not found.");
        }

        dom.dictionaryResult.innerHTML = `
            <strong>${escapeHtml(capitalizeWords(query))}${phonetic ? ` <span class="dictionary-phonetic">${escapeHtml(phonetic)}</span>` : ""}</strong>
            ${meanings.map((meaning) => `
                <p><strong>${escapeHtml(meaning.partOfSpeech || "definition")}:</strong> ${escapeHtml(meaning.definition)}</p>
                ${meaning.example ? `<p><em>Example:</em> ${escapeHtml(meaning.example)}</p>` : ""}
            `).join("")}
        `;
    } catch (err) {
        const fallback = ENGLISH_DICTIONARY_FALLBACK[query];
        dom.dictionaryResult.innerHTML = fallback
            ? `<strong>${escapeHtml(capitalizeWords(query))}</strong><p>${escapeHtml(fallback)}</p>`
            : `No English dictionary definition found for "${escapeHtml(query)}". Check the spelling and try again.`;
    }
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
        const message = "Audio recording is not supported in this browser.";
        if (dom.recordingStatus) {
            dom.recordingStatus.textContent = message;
        }
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
        showMicError(err);
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
        const label = isRecording ? "Stop Recording" : "Start Recording";
        if (isChurchStudioPage) {
            dom.recordButton.setAttribute("aria-label", label);
            dom.recordButton.title = label;
        } else {
            dom.recordButton.textContent = label;
        }
    }

    if (dom.downloadAudioButton) {
        dom.downloadAudioButton.disabled = !recordingUrl;
        if (isChurchStudioPage) {
            const label = recordingUrl ? "Download Audio" : "Record audio before downloading";
            dom.downloadAudioButton.setAttribute("aria-label", label);
            dom.downloadAudioButton.title = label;
        }
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
    const isVisible = !isChurchStudioPage || dom.liveVisibilityButton?.textContent?.trim().toLowerCase() === "live";
    const payload = {
        reference: isVisible ? reference : "",
        text: isVisible ? text : "",
        visible: isVisible,
        updatedAt: new Date().toISOString()
    };

    writeStorage(STORAGE_KEYS.liveOverlay, payload);
    liveOverlayChannel?.postMessage(payload);
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
        return "Connect a microphone to use live listening.";
    }

    switch (err.name) {
        case "NotAllowedError":
        case "PermissionDeniedError":
        case "SecurityError":
            return "Allow microphone access in the browser to use live listening.";
        case "NotFoundError":
        case "DevicesNotFoundError":
            return "Connect a microphone to use live listening.";
        case "NotReadableError":
        case "TrackStartError":
            return "Close other apps using the microphone, then try live listening again.";
        default:
            return "Live listening is paused. Check microphone permissions or connect a microphone.";
    }
}

window.omnicastChurchActions = {
    archiveCurrentSession,
    clearNotes,
    copyObsOverlayUrl,
    copySocialCaption,
    downloadNotes,
    downloadRecording,
    fillSocialCaption,
    toggleRecording,
    async toggleListening() {
        if (listeningActive) {
            await stopMic();
            refreshMicUi("Mic status");
            return;
        }

        await startMic();
    }
};
