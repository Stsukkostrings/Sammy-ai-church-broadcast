/*
 AI Church Broadcast
 Â© 2026 Samuel Olasunkanmi
 Unauthorized use is prohibited
*/

const AUTH_STORAGE_KEY = "ai_cb_auth_session";
const PENDING_VERIFICATION_KEY = "ai_cb_pending_verification_email";
const LEGACY_USERS_STORAGE_KEY = "ai_cb_local_users_v2";

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function getBasePath() {
    return (window.location.pathname || "").includes("/signup/") ? ".." : ".";
}

function getAppPath() {
    return `${getBasePath()}/home.html`;
}

function getHomePath() {
    return `${getBasePath()}/index.html`;
}

function getAuthApiUrl(action) {
    return `${getBasePath()}/api/auth?action=${encodeURIComponent(action)}`;
}

function getPhpAuthApiUrl(action) {
    return `${getBasePath()}/backend/auth.php?action=${encodeURIComponent(action)}`;
}

function isLocalDevelopment() {
    const hostname = window.location.hostname || "";
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "";
}

async function postAuth(action, payload) {
    try {
        return await postAuthToUrl(getAuthApiUrl(action), payload);
    } catch (error) {
        if (!isLocalDevelopment()) {
            throw error;
        }

        return postAuthToUrl(getPhpAuthApiUrl(action), payload);
    }
}

async function postAuthToUrl(url, payload) {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload || {})
    });

    let data;
    try {
        data = await response.json();
    } catch (err) {
        throw new Error("Authentication service returned an invalid response.");
    }

    if (!response.ok || !data?.success) {
        const error = new Error(data?.error || "Authentication request failed.");
        if (data?.pendingVerification) {
            error.pendingVerification = true;
            error.email = data.email || normalizeEmail(payload?.email);
        }
        throw error;
    }

    return data;
}

function readLegacyLocalUsers() {
    try {
        return JSON.parse(localStorage.getItem(LEGACY_USERS_STORAGE_KEY) || "[]");
    } catch (err) {
        console.warn("Failed to read legacy local users:", err);
        return [];
    }
}

function getSession() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    } catch (err) {
        console.warn("Failed to read auth session:", err);
        return null;
    }
}

function saveSession(user) {
    const session = {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        loginAt: new Date().toISOString()
    };

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    localStorage.setItem("user_id", String(user.id));
    localStorage.setItem("username", user.fullName || user.email);
    return session;
}

function clearSession() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem("user_id");
    localStorage.removeItem("username");
}

function getPendingVerificationEmail() {
    return sessionStorage.getItem(PENDING_VERIFICATION_KEY) || "";
}

function setPendingVerificationEmail(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) {
        sessionStorage.removeItem(PENDING_VERIFICATION_KEY);
        return "";
    }

    sessionStorage.setItem(PENDING_VERIFICATION_KEY, normalized);
    return normalized;
}

function clearPendingVerificationEmail() {
    sessionStorage.removeItem(PENDING_VERIFICATION_KEY);
}

async function sha256(text) {
    const payload = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", payload);
    return Array.from(new Uint8Array(hashBuffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function register(payload) {
    const fullName = String(payload.fullName || "").trim();
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || "");

    if (!fullName || !email || !password) {
        throw new Error("Full name, email, and password are required.");
    }

    const response = await postAuth("register-start", { fullName, email, password });
    setPendingVerificationEmail(response.email || email);
    return {
        pendingVerification: true,
        email: response.email || email,
        expiresAt: response.expiresAt || null,
        message: response.message || "A verification code has been sent to your email."
    };
}

function normalizeRegisterPayload(payloadOrEmail, maybePassword) {
    if (typeof payloadOrEmail === "object" && payloadOrEmail !== null) {
        return payloadOrEmail;
    }

    const email = String(payloadOrEmail || "").trim();
    const localPart = email.includes("@") ? email.split("@")[0] : email;
    return {
        fullName: localPart || "Broadcast User",
        email,
        password: maybePassword
    };
}

function normalizeLoginPayload(payloadOrEmail, maybePassword) {
    if (typeof payloadOrEmail === "object" && payloadOrEmail !== null) {
        return payloadOrEmail;
    }

    return {
        email: payloadOrEmail,
        password: maybePassword
    };
}

async function verifyEmail(payload) {
    const email = normalizeEmail(payload.email || getPendingVerificationEmail());
    const code = String(payload.code || "").trim();

    if (!email || !code) {
        throw new Error("Email and verification code are required.");
    }

    const response = await postAuth("verify-email", { email, code });
    clearPendingVerificationEmail();
    return saveSession(response.user);
}

async function resendVerification(email) {
    const normalizedEmail = normalizeEmail(email || getPendingVerificationEmail());
    if (!normalizedEmail) {
        throw new Error("Enter the email address you used to sign up.");
    }

    const response = await postAuth("resend-verification", { email: normalizedEmail });
    setPendingVerificationEmail(response.email || normalizedEmail);
    return response;
}

async function login(payloadOrEmail, maybePassword) {
    const payload = normalizeLoginPayload(payloadOrEmail, maybePassword);
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || "");

    try {
        const response = await postAuth("login", { email, password });
        clearPendingVerificationEmail();
        return saveSession(response.user);
    } catch (error) {
        if (!isLocalDevelopment() || error.pendingVerification) {
            throw error;
        }

        const legacySession = await loginLegacyLocalUser(email, password);
        if (!legacySession) {
            throw error;
        }

        clearPendingVerificationEmail();
        return legacySession;
    }
}

async function loginLegacyLocalUser(email, password) {
    const users = readLegacyLocalUsers();
    const user = users.find((entry) => normalizeEmail(entry.email) === email);

    if (!user || !user.salt || !user.passwordHash) {
        return null;
    }

    const passwordHash = await sha256(`${user.salt}:${password}`);
    if (passwordHash !== user.passwordHash) {
        return null;
    }

    return saveSession({
        id: user.id,
        fullName: user.fullName || user.email,
        email: user.email
    });
}

function logout() {
    clearSession();
}

function redirectIfAuthenticated() {
    if (!getSession()) {
        return false;
    }

    window.location.replace(getAppPath());
    return true;
}

function requireAuth() {
    if (getSession()) {
        return true;
    }

    window.location.replace(`${getBasePath()}/signup/login.html`);
    return false;
}

window.AuthStore = {
    register,
    signup: (payloadOrEmail, maybePassword) => register(normalizeRegisterPayload(payloadOrEmail, maybePassword)),
    verifyEmail,
    resendVerification,
    login,
    logout,
    getSession,
    redirectIfAuthenticated,
    requireAuth,
    getAppPath,
    getHomePath,
    getPendingVerificationEmail,
    setPendingVerificationEmail,
    clearPendingVerificationEmail
};
