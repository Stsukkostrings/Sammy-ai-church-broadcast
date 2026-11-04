// The former Netlify-only email/password flow returned unauthenticated user
// objects and used a paid email dependency. Keep the legacy endpoint fail-closed
// until a Netlify adapter for the approved Supabase architecture is implemented.
exports.handler = async function handler() {
    return {
        statusCode: 410,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ ok: false, error: 'This legacy authentication endpoint is disabled. Use the configured Omnicast sign-in flow.' })
    };
};
