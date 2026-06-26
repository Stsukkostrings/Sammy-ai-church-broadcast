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
    const isChurchStudioPage = pathname.endsWith("/church_studio.html");
    const isLyricsPage = pathname.endsWith("/omnicast_lyrics.html");
    const isHomePage = pathname.endsWith("/home.html");
    const isLandingPage =
        pathname.endsWith("/index.html") ||
        pathname === "/" ||
        pathname.endsWith("/omnicast-ai") ||
        pathname.endsWith("/ai-church-broadcast");

    const logoLink = isStudioPage || isChurchStudioPage || isLyricsPage ? "index.html" : isHomePage ? "home.html#studio" : "index.html";
    const churchStudioLink = isStudioPage ? '<a href="church_studio.html">Church Studio</a>' : "";
    const lyricsLink = isChurchStudioPage || isStudioPage ? '<a href="omnicast_lyrics.html">Lyrics</a>' : "";

    if (isChurchStudioPage || isStudioPage) {
        navMount.innerHTML = "";
        return;
    }

    if (isLandingPage) {
        navMount.innerHTML = `
        <div class="nav index-nav">
            <a class="logo" href="index.html">OmniCast AI</a>
            <div class="links">
                <a href="church_studio.html">Church Studio</a>
                <a href="spiritflow_creator_studio.html">Creator Studio</a>
                <a href="omnicast_lyrics.html">Lyrics</a>
                <a href="studio.html">Main Studio</a>
                <a href="#about">About</a>
            </div>
        </div>
        `;
        return;
    }

    navMount.innerHTML = `
    <div class="nav">
        <a class="logo" href="${logoLink}">OmniCast AI</a>

        <div class="links">
            ${churchStudioLink}
            ${lyricsLink}
        </div>
    </div>
    `;
}

window.renderNavbar = renderNavbar;
renderNavbar();
