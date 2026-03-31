/*
 AI Church Broadcast
 © 2026 Samuel Olasunkanmi
 Unauthorized use is prohibited
*/

function renderNavbar() {
    const navMount = document.getElementById("navbar");
    if (!navMount) {
        return;
    }

    const session = window.AuthStore ? window.AuthStore.getSession() : null;
    const pathname = window.location.pathname || "";
    const isStudioPage = pathname.endsWith("/studio.html");
    const isHomePage = pathname.endsWith("/home.html");
    const isLandingPage = pathname.endsWith("/index.html") || pathname === "/" || pathname.endsWith("/ai-church-broadcast");
    const studioLink = isLandingPage
        ? "signup/login.html"
        : isHomePage
            ? (session ? "studio.html" : "#authPanel")
            : "studio.html";
    const studioLabel = isLandingPage ? "Launch App Studio" : isStudioPage ? "Open Workspace" : "Open Studio";
    const aboutLink = isStudioPage ? "home.html#about" : isHomePage ? "#about" : "about.html";
    const contactLink = isStudioPage ? "home.html#contact" : isHomePage ? "#contact" : "home.html#contact";
    const logoLink = isStudioPage ? "index.html" : isHomePage ? "home.html#studio" : "index.html";
    const loginLink = isHomePage ? "#authPanel" : "signup/login.html";

    navMount.innerHTML = `
    <div class="nav">
        <a class="logo" href="${logoLink}">AI Church Broadcast</a>

        <div class="links">
            <a href="${studioLink}">${studioLabel}</a>
            <a href="${aboutLink}">About</a>
            <a href="${contactLink}">Contact Us</a>
            <a href="${isStudioPage ? "privacy.html" : "privacy.html"}">Privacy</a>
            <a href="${isStudioPage ? "terms.html" : "terms.html"}">Terms</a>
        </div>

        <div class="auth-nav">
            ${session
                ? '<button class="button-secondary nav-button" id="navLogoutButton" type="button">Logout</button>'
                : `<a class="button-secondary nav-button" href="${loginLink}">Login</a>`}
        </div>
    </div>
    `;

    const navLogoutButton = document.getElementById("navLogoutButton");
    if (navLogoutButton) {
        navLogoutButton.addEventListener("click", () => {
            window.AuthStore.logout();
            renderNavbar();
            window.location.href = window.AuthStore?.getHomePath?.() || "index.html";
        });
    }
}

window.renderNavbar = renderNavbar;
renderNavbar();
