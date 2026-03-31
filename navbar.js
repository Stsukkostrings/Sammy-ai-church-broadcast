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
    const isHomePage = pathname.endsWith("/home.html") || pathname === "/" || pathname.endsWith("/ai-church-broadcast");
    const studioLink = isHomePage ? "signup/login.html" : "studio.html";
    const aboutLink = isStudioPage ? "index.html#about" : isHomePage ? "about.html" : "#about";
    const contactLink = isStudioPage ? "index.html#contact" : isHomePage ? "about.html" : "#contact";

    navMount.innerHTML = `
    <div class="nav">
        <a class="logo" href="${isStudioPage ? "index.html" : "#studio"}">Web Studio</a>

        <div class="links">
            <a href="${studioLink}">${isStudioPage ? "Workspace" : "Studio"}</a>
            <a href="${aboutLink}">About</a>
            <a href="${contactLink}">Contact Us</a>
            <a href="${isStudioPage ? "privacy.html" : "privacy.html"}">Privacy</a>
            <a href="${isStudioPage ? "terms.html" : "terms.html"}">Terms</a>
        </div>

        <div class="auth-nav">
            ${session
                ? '<button class="button-secondary nav-button" id="navLogoutButton" type="button">Logout</button>'
                : '<a class="button-secondary nav-button" href="#authPanel">Login</a>'}
        </div>
    </div>
    `;

    const navLogoutButton = document.getElementById("navLogoutButton");
    if (navLogoutButton) {
        navLogoutButton.addEventListener("click", () => {
            window.AuthStore.logout();
            renderNavbar();
            window.location.href = window.AuthStore?.getHomePath?.() || "home.html";
        });
    }
}

window.renderNavbar = renderNavbar;
renderNavbar();
