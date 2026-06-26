const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

const USERS_STORE = "auth-users";
const PENDING_STORE = "auth-pending";
const DEFAULT_CODE_TTL_MINUTES = 10;

exports.handler = async function handler(event) {
    const headers = {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 204,
            headers
        };
    }

    if (event.httpMethod !== "POST") {
        return jsonResponse(405, { success: false, error: "Method not allowed." }, headers);
    }

    const action = event.queryStringParameters?.action || "";
    const payload = safeJsonParse(event.body);

    try {
        switch (action) {
            case "register-start":
                return await handleRegisterStart(payload, headers);
            case "verify-email":
                return await handleVerifyEmail(payload, headers);
            case "resend-verification":
                return await handleResendVerification(payload, headers);
            case "login":
                return await handleLogin(payload, headers);
            default:
                return jsonResponse(404, { success: false, error: "Unknown action." }, headers);
        }
    } catch (error) {
        console.error("Auth function error:", error);
        return jsonResponse(500, { success: false, error: "Internal server error." }, headers);
    }
};

async function handleRegisterStart(payload, headers) {
    const fullName = String(payload.fullName || "").trim();
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || "");

    if (!fullName || !email || !password) {
        return jsonResponse(400, { success: false, error: "Full name, email, and password are required." }, headers);
    }

    if (!isValidEmail(email)) {
        return jsonResponse(400, { success: false, error: "Enter a valid email address." }, headers);
    }

    if (password.length < 6) {
        return jsonResponse(400, { success: false, error: "Password must be at least 6 characters." }, headers);
    }

    const users = getStore(USERS_STORE);
    const pending = getStore(PENDING_STORE);
    const userKey = emailKey(email);

    const existingUser = await users.get(userKey, { type: "json" });
    if (existingUser) {
        return jsonResponse(400, { success: false, error: "An account already exists for this email." }, headers);
    }

    const code = generateVerificationCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + getCodeTtlMinutes() * 60 * 1000).toISOString();

    const currentPending = await pending.get(userKey, { type: "json" });
    const pendingRecord = {
        fullName,
        email,
        passwordHash: hashPassword(password),
        codeHash: hashCode(code),
        createdAt: currentPending?.createdAt || now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt
    };

    await pending.setJSON(userKey, pendingRecord);
    await sendVerificationEmail(email, fullName, code);

    return jsonResponse(200, {
        success: true,
        pendingVerification: true,
        email,
        expiresAt,
        message: "A verification code has been sent to your email address."
    }, headers);
}

async function handleVerifyEmail(payload, headers) {
    const email = normalizeEmail(payload.email);
    const code = String(payload.code || "").replace(/\D+/g, "");

    if (!email || !code) {
        return jsonResponse(400, { success: false, error: "Email and verification code are required." }, headers);
    }

    const users = getStore(USERS_STORE);
    const pending = getStore(PENDING_STORE);
    const userKey = emailKey(email);
    const pendingRecord = await pending.get(userKey, { type: "json" });

    if (!pendingRecord) {
        return jsonResponse(400, { success: false, error: "No pending verification was found for this email." }, headers);
    }

    if (Date.parse(pendingRecord.expiresAt || "") < Date.now()) {
        await pending.delete(userKey);
        return jsonResponse(400, { success: false, error: "This verification code has expired. Request a new code and try again." }, headers);
    }

    if (!safeCompareHash(pendingRecord.codeHash, hashCode(code))) {
        return jsonResponse(400, { success: false, error: "The verification code is invalid." }, headers);
    }

    const existingUser = await users.get(userKey, { type: "json" });
    if (existingUser) {
        await pending.delete(userKey);
        return jsonResponse(400, { success: false, error: "An account already exists for this email." }, headers);
    }

    const user = {
        id: Date.now() + crypto.randomInt(10, 999),
        fullName: pendingRecord.fullName,
        email,
        passwordHash: pendingRecord.passwordHash,
        createdAt: pendingRecord.createdAt || new Date().toISOString(),
        verifiedAt: new Date().toISOString()
    };

    await users.setJSON(userKey, user);
    await pending.delete(userKey);

    return jsonResponse(200, {
        success: true,
        user: publicUser(user)
    }, headers);
}

async function handleResendVerification(payload, headers) {
    const email = normalizeEmail(payload.email);
    if (!email) {
        return jsonResponse(400, { success: false, error: "Email is required." }, headers);
    }

    const pending = getStore(PENDING_STORE);
    const userKey = emailKey(email);
    const pendingRecord = await pending.get(userKey, { type: "json" });

    if (!pendingRecord) {
        return jsonResponse(400, { success: false, error: "No pending verification was found for this email." }, headers);
    }

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + getCodeTtlMinutes() * 60 * 1000).toISOString();
    const nextRecord = {
        ...pendingRecord,
        codeHash: hashCode(code),
        updatedAt: new Date().toISOString(),
        expiresAt
    };

    await pending.setJSON(userKey, nextRecord);
    await sendVerificationEmail(email, pendingRecord.fullName, code);

    return jsonResponse(200, {
        success: true,
        pendingVerification: true,
        email,
        expiresAt,
        message: "A new verification code has been sent."
    }, headers);
}

async function handleLogin(payload, headers) {
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || "");

    if (!email || !password) {
        return jsonResponse(400, { success: false, error: "Email and password are required." }, headers);
    }

    const users = getStore(USERS_STORE);
    const pending = getStore(PENDING_STORE);
    const userKey = emailKey(email);

    const user = await users.get(userKey, { type: "json" });
    if (!user) {
        const pendingRecord = await pending.get(userKey, { type: "json" });
        if (pendingRecord) {
            return jsonResponse(403, {
                success: false,
                error: "Your account has not been verified yet. Enter the code sent to your email.",
                pendingVerification: true,
                email
            }, headers);
        }

        return jsonResponse(401, { success: false, error: "Invalid email or password." }, headers);
    }

    if (!safeCompareHash(user.passwordHash, hashPassword(password))) {
        return jsonResponse(401, { success: false, error: "Invalid email or password." }, headers);
    }

    return jsonResponse(200, {
        success: true,
        user: publicUser(user)
    }, headers);
}

async function sendVerificationEmail(email, fullName, code) {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.AUTH_FROM_EMAIL;
    const fromName = process.env.AUTH_FROM_NAME || "AI Church Broadcast";

    if (!apiKey || !fromEmail) {
        throw new Error("Missing RESEND_API_KEY or AUTH_FROM_EMAIL environment variable.");
    }

    const safeName = String(fullName || "").trim() || "there";
    const ttlMinutes = getCodeTtlMinutes();
    const subject = "Your AI Church Broadcast verification code";
    const text = [
        `Hello ${safeName},`,
        "",
        "Use this verification code to finish creating your AI Church Broadcast account:",
        "",
        code,
        "",
        `This code expires in ${ttlMinutes} minutes.`,
        "",
        "If you did not request this code, you can ignore this email."
    ].join("\n");

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: `${fromName} <${fromEmail}>`,
            to: [email],
            subject,
            text
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Resend email send failed: ${errorText}`);
    }
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function emailKey(email) {
    return encodeURIComponent(email);
}

function generateVerificationCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashPassword(password) {
    return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function hashCode(code) {
    return crypto.createHash("sha256").update(String(code).trim()).digest("hex");
}

function safeCompareHash(left, right) {
    try {
        const leftBuffer = Buffer.from(String(left || ""), "utf8");
        const rightBuffer = Buffer.from(String(right || ""), "utf8");
        if (leftBuffer.length !== rightBuffer.length) {
            return false;
        }
        return crypto.timingSafeEqual(leftBuffer, rightBuffer);
    } catch (error) {
        return false;
    }
}

function publicUser(user) {
    return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        createdAt: user.createdAt || null,
        verifiedAt: user.verifiedAt || null
    };
}

function getCodeTtlMinutes() {
    const parsed = Number.parseInt(process.env.AUTH_CODE_TTL_MINUTES || "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CODE_TTL_MINUTES;
}

function safeJsonParse(value) {
    if (!value) {
        return {};
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return {};
    }
}

function jsonResponse(statusCode, body, headers) {
    return {
        statusCode,
        headers,
        body: JSON.stringify(body)
    };
}
