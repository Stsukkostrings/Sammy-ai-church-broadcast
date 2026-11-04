exports.handler = async function handler() {
    return {
        statusCode: 200,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
        body: JSON.stringify({
            success: true,
            service: "netlify-functions",
            function: "health"
        })
    };
};
