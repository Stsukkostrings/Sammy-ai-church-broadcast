(function () {
    "use strict";

    const WHISPER_MODULE_URL = "/node_modules/@timur00kh/whisper.wasm/dist/index.es.js";
    const MODEL_URL = "/whisper-assets/ggml-tiny.bin";
    const CHUNK_MS = 4500;

    let servicePromise = null;
    let service = null;
    let convertFromArrayBuffer = null;
    let activeStream = null;
    let activeRecorder = null;
    let running = false;
    let processing = false;
    let pendingBlob = null;
    let callbacks = {};
    let chunkTimer = null;

    function emitStatus(message) {
        callbacks.onStatus?.(message);
    }

    function emitError(error) {
        callbacks.onError?.(error);
    }

    function getRecorderMimeType() {
        const candidates = [
            "audio/webm;codecs=opus",
            "audio/webm",
            "audio/ogg;codecs=opus",
            "audio/mp4"
        ];
        return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
    }

    function isDesktopPreferred() {
        return window.electronAPI?.speechEngine === "local-whisper-preferred";
    }

    function isAvailable() {
        return Boolean(
            isDesktopPreferred()
            && window.crossOriginIsolated
            && window.MediaRecorder
            && window.AudioContext
            && window.WebAssembly
        );
    }

    async function loadService() {
        if (servicePromise) {
            return servicePromise;
        }

        servicePromise = (async () => {
            emitStatus("Loading local Whisper engine...");
            const whisperModule = await import(WHISPER_MODULE_URL);
            convertFromArrayBuffer = whisperModule.convertFromArrayBuffer;
            service = new whisperModule.WhisperWasmService({ logLevel: 0 });

            const supported = await service.checkWasmSupport();
            if (!supported) {
                throw new Error("This desktop build cannot run the local Whisper engine.");
            }

            emitStatus("Loading local Whisper model...");
            const response = await fetch(MODEL_URL, { cache: "force-cache" });
            if (!response.ok) {
                throw new Error(`Unable to load Whisper model (${response.status}).`);
            }

            const modelBuffer = await response.arrayBuffer();
            await service.initModel(new Uint8Array(modelBuffer));
            emitStatus("Local Whisper ready.");
            return service;
        })().catch((error) => {
            servicePromise = null;
            service = null;
            throw error;
        });

        return servicePromise;
    }

    function startNextChunk() {
        if (!running || !activeStream) {
            return;
        }

        const mimeType = getRecorderMimeType();
        activeRecorder = mimeType
            ? new MediaRecorder(activeStream, { mimeType })
            : new MediaRecorder(activeStream);
        const chunks = [];

        activeRecorder.ondataavailable = (event) => {
            if (event.data?.size) {
                chunks.push(event.data);
            }
        };

        activeRecorder.onerror = (event) => {
            emitError(event.error || new Error("Local Whisper recorder failed."));
            if (running) {
                startNextChunk();
            }
        };

        activeRecorder.onstop = () => {
            if (chunks.length) {
                queueBlob(new Blob(chunks, { type: activeRecorder.mimeType || mimeType || "audio/webm" }));
            }
            activeRecorder = null;
            if (running) {
                startNextChunk();
            }
        };

        activeRecorder.start();
        chunkTimer = window.setTimeout(() => {
            if (activeRecorder?.state === "recording") {
                activeRecorder.stop();
            }
        }, CHUNK_MS);
    }

    function queueBlob(blob) {
        pendingBlob = blob;
        void processPending();
    }

    async function processPending() {
        if (processing || !pendingBlob || !running) {
            return;
        }

        processing = true;
        const blob = pendingBlob;
        pendingBlob = null;

        try {
            emitStatus("Transcribing with local Whisper...");
            const buffer = await blob.arrayBuffer();
            const converted = await convertFromArrayBuffer(buffer, {
                normalize: true,
                targetSampleRate: 16000
            });
            const audioData = converted.audioData || converted.data;
            if (!audioData?.length) {
                throw new Error("No speech audio was captured.");
            }

            const segmentTexts = [];
            const threads = Math.min(Math.max((navigator.hardwareConcurrency || 4) - 1, 2), 4);
            const result = await service.transcribe((audioData), (segment) => {
                const text = String(segment?.text || "").trim();
                if (text) {
                    segmentTexts.push(text);
                    callbacks.onTranscript?.(text, { isFinal: true, source: "local-whisper", segment });
                }
            }, {
                language: "en",
                threads,
                translate: false
            });

            const fullText = (result?.segments || [])
                .map((segment) => String(segment?.text || "").trim())
                .filter(Boolean)
                .join(" ")
                .trim();
            if (fullText && !segmentTexts.length) {
                callbacks.onTranscript?.(fullText, { isFinal: true, source: "local-whisper" });
            }
            emitStatus("Listening with local Whisper.");
        } catch (error) {
            emitError(error);
            emitStatus("Local Whisper is still listening.");
        } finally {
            processing = false;
            if (pendingBlob && running) {
                void processPending();
            }
        }
    }

    async function start(stream, nextCallbacks = {}) {
        if (!isAvailable()) {
            throw new Error("Local Whisper requires the Electron desktop app with cross-origin isolation.");
        }

        callbacks = nextCallbacks;
        activeStream = stream;
        await loadService();

        running = true;
        emitStatus("Listening with local Whisper.");
        startNextChunk();
    }

    async function stop() {
        running = false;
        pendingBlob = null;
        callbacks = {};
        if (chunkTimer) {
            window.clearTimeout(chunkTimer);
            chunkTimer = null;
        }
        if (activeRecorder?.state === "recording") {
            activeRecorder.stop();
        }
        activeRecorder = null;
        activeStream = null;
    }

    window.omnicastDesktopWhisper = {
        isAvailable,
        start,
        stop,
        getStatus: () => ({
            running,
            processing,
            loaded: Boolean(service)
        })
    };
}());
