/*
 OmniCast AI
 AdSense-ready ad loader

 Replace ADS_CONFIG.publisherId and each data-ad-slot value with live IDs from
 your AdSense account after the site is approved.
*/

(function () {
    const ADS_CONFIG = {
        publisherId: "ca-pub-REPLACE_WITH_YOUR_PUBLISHER_ID",
        scriptLoaded: false
    };

    function hasLivePublisherId() {
        return /^ca-pub-\d{16}$/.test(ADS_CONFIG.publisherId);
    }

    function loadAdSenseScript() {
        if (ADS_CONFIG.scriptLoaded || !hasLivePublisherId()) {
            return;
        }

        const script = document.createElement("script");
        script.async = true;
        script.crossOrigin = "anonymous";
        script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS_CONFIG.publisherId}`;
        document.head.appendChild(script);
        ADS_CONFIG.scriptLoaded = true;
    }

    function prepareSlot(slot) {
        const adSlotId = slot.dataset.adSlot || "REPLACE_WITH_AD_SLOT_ID";
        const adFormat = slot.dataset.adFormat || "auto";

        slot.setAttribute("aria-label", "Advertisement");

        if (!hasLivePublisherId() || !/^\d+$/.test(adSlotId)) {
            slot.classList.add("ad-slot-placeholder");
            slot.innerHTML = "<span>Advertisement space</span>";
            return;
        }

        const adElement = document.createElement("ins");
        adElement.className = "adsbygoogle";
        adElement.style.display = "block";
        adElement.dataset.adClient = ADS_CONFIG.publisherId;
        adElement.dataset.adSlot = adSlotId;
        adElement.dataset.adFormat = adFormat;
        adElement.dataset.fullWidthResponsive = "true";

        slot.innerHTML = "";
        slot.appendChild(adElement);

        window.adsbygoogle = window.adsbygoogle || [];
        window.adsbygoogle.push({});
    }

    function initAds() {
        const slots = document.querySelectorAll("[data-ad-slot]");

        if (!slots.length) {
            return;
        }

        loadAdSenseScript();
        slots.forEach(prepareSlot);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initAds);
    } else {
        initAds();
    }
})();
