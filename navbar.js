/*
 OmniCast AI
 © 2026 Samuel Olasunkanmi
 Unauthorized use is prohibited
*/

function renderNavbar() {
    const navMount = document.getElementById("navbar");
    if (!navMount) {
        return;
    }

    const pathname = window.location.pathname || "";
    const isStudioPage = pathname.endsWith("/studio.html");
    const isHomePage = pathname.endsWith("/home.html");
    const isLandingPage =
        pathname.endsWith("/index.html") ||
        pathname === "/" ||
        pathname.endsWith("/omnicast-ai") ||
        pathname.endsWith("/ai-church-broadcast");

    const studioLink = isLandingPage ? "index.html" : isHomePage ? "index.html" : "index.html";
    const studioLabel = isLandingPage ? "Launch OmniCast Studio" : isStudioPage ? "Open Workspace" : "Open Studio";
    const aboutLink = isStudioPage ? "about.html" : isHomePage ? "about.html" : "about.html";
    const contactLink = isStudioPage ? "home.html#contact" : isHomePage ? "#contact" : "home.html#contact";
    const logoLink = isStudioPage ? "index.html" : isHomePage ? "home.html#studio" : "index.html";

    navMount.innerHTML = `
    <div class="nav">
        <a class="logo" href="${logoLink}">OmniCast AI</a>

        <div class="links">
            <a href="${studioLink}">${studioLabel}</a>
            <a href="${aboutLink}">About</a>
            <a href="${contactLink}">Contact Us</a>
            <a href="privacy.html">Privacy</a>
            <a href="terms.html">Terms</a>
        </div>
    </div>
    `;
}

window.renderNavbar = renderNavbar;
renderNavbar();
