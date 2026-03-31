/*
 AI Church Broadcast
 © 2026 Samuel Olasunkanmi
 Unauthorized use is prohibited
*/

const AUTH_STORAGE_KEY = "ai_cb_auth_session";
const USERS_STORAGE_KEY = "ai_cb_local_users_v2";

function readLocalUsers() {
    try {
        return JSON.parse(localStorage.getItem(USERS_STORAGE_KEY) || "[]");
    } catch (err) {
        console.warn("Failed to read local users:", err);
        return [];
    }
}

function writeLocalUsers(users) {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function getBasePath() {
    return (window.location.pathname || "").includes("/signup/") ? ".." : ".";
}

function getAppPath() {
    return `${getBasePath()}/studio.html`;
}

function getHomePath() {
    return `${getBasePath()}/home.html`;
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

async function sha256(text) {
    const payload = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", payload);
    return Array.from(new Uint8Array(hashBuffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function randomSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
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

    const users = readLocalUsers();
    if (users.some((user) => normalizeEmail(user.email) === email)) {
        throw new Error("An account already exists for this email.");
    }

    const salt = randomSalt();
    const passwordHash = await sha256(`${salt}:${password}`);
    const user = {
        id: Date.now(),
        fullName,
        email,
        salt,
        passwordHash,
        createdAt: new Date().toISOString()
    };

    users.push(user);
    writeLocalUsers(users);
    return saveSession(user);
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

async function login(payloadOrEmail, maybePassword) {
    const payload = normalizeLoginPayload(payloadOrEmail, maybePassword);
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || "");
    const users = readLocalUsers();
    const user = users.find((entry) => normalizeEmail(entry.email) === email);

    if (!user) {
        throw new Error("Invalid email or password.");
    }

    const passwordHash = await sha256(`${user.salt}:${password}`);
    if (passwordHash !== user.passwordHash) {
        throw new Error("Invalid email or password.");
    }

    return saveSession(user);
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
    login,
    logout,
    getSession,
    redirectIfAuthenticated,
    requireAuth,
    getAppPath,
    getHomePath
};
