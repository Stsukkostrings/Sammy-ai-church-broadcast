exports.handler = async function handler() {
    return {
        statusCode: 200,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
            success: true,
            service: "netlify-functions",
            function: "health"
        })
    };
};
