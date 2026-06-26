# OmniCast AI Ads Setup

This web app is now AdSense-ready. The code is present, but it will only show placeholder ad spaces until you replace the IDs with real Google AdSense values.

## Low-cost route

1. Buy or use an existing domain.
2. Host the site on a low-cost/free host such as Netlify, Vercel, GitHub Pages, or your current cPanel hosting.
3. Make sure `privacy.html`, `terms.html`, and `about.html` are reachable from the public website.
4. Apply for Google AdSense at `https://www.google.com/adsense/`.
5. After approval, create display ad units in AdSense.
6. Replace `ca-pub-REPLACE_WITH_YOUR_PUBLISHER_ID` in `ads.js` with your real Publisher ID.
7. Replace every `data-ad-slot="REPLACE_WITH_AD_SLOT_ID"` in the HTML pages with the ad unit slot ID from AdSense.
8. Upload the updated files and wait for ads to start serving.

## Expected money needed

- AdSense account: free.
- Domain: usually about $10-$20 per year, depending on registrar and domain extension.
- Hosting: can be free at first on Netlify, Vercel, or GitHub Pages. Paid shared hosting is usually optional.
- Consent/privacy tool: optional at the beginning, but may become necessary if you target regions with stricter cookie consent rules.
- Google Play Developer account for Android app monetization later: one-time $25.

## Recommended placements already added

- `index.html`: one landing page ad near the footer.
- `home.html`: one ad after the hero and one near the footer.
- `studio.html`: one ad below the top studio controls and one before the footer.
- `about.html`, `privacy.html`, `terms.html`: one ad near the footer.

No ads were added to `lower-third.html` because that page is intended for OBS/browser-source broadcast output.

The active root web pages were updated. If you later build the Capacitor/Android package from `www`, mirror these same ad files and slots into `www` before running the Android build.

## Notes

Use AdSense for the web app first because it is the cheapest path. Use AdMob later for the Android build if you package and publish the app. For AdMob, you will also need a public developer website and an `app-ads.txt` file after Google gives you the exact publisher line.
