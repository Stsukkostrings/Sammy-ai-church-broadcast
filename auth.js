/*
 AI Church Broadcast
 Â© 2026 Samuel Olasunkanmi
 Unauthorized use is prohibited
*/

function getBasePath() {
    return (window.location.pathname || "").includes("/signup/") ? ".." : ".";
}

function getAppPath() {
    return `${getBasePath()}/home.html`;
}

function getHomePath() {
    return `${getBasePath()}/index.html`;
}

window.AuthStore = {
    register: async () => ({ success: true }),
    signup: async () => ({ success: true }),
    verifyEmail: async () => ({ success: true }),
    resendVerification: async () => ({ success: true }),
    login: async () => ({ success: true }),
    logout: () => {},
    getSession: () => ({ id: "guest", fullName: "Broadcast Team", email: "" }),
    redirectIfAuthenticated: () => false,
    requireAuth: () => true,
    getAppPath,
    getHomePath,
    getPendingVerificationEmail: () => "",
    setPendingVerificationEmail: () => "",
    clearPendingVerificationEmail: () => {}
};
