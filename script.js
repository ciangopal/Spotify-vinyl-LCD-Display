
/* =====================================
   1. SPOTIFY CONFIGURATION
===================================== */

const CLIENT_ID = "920889e51cc642248f5fa2c21b841542";

const REDIRECT_URI =
    "https://ciangopal.github.io/Spotify-vinyl-LCD-Display/";

const SCOPES = "user-read-currently-playing";

const AUTH_URL =
    "https://accounts.spotify.com/authorize";

const TOKEN_URL =
    "https://accounts.spotify.com/api/token";

const API_URL =
    "https://api.spotify.com/v1/me/player/currently-playing";

const POLL_INTERVAL = 5000;


/* =====================================
   2. DOM ELEMENTS & STATE
===================================== */

const vinyl = document.getElementById("vinyl");
const album = document.getElementById("album");
const statusOverlay = document.getElementById("status");

let accessToken = null;
let refreshToken = null;
let expiresAt = 0;

let currentTrackId = null;
let artworkRequest = 0;

let pollTimer = null;
let polling = false;


/* =====================================
   3. STATUS DISPLAY
===================================== */

function showStatus(message, showButton = false) {

    statusOverlay.replaceChildren();

    if (!message) return;

    const text = document.createElement("div");
    text.textContent = message;

    statusOverlay.appendChild(text);

    if (showButton) {

        const button = document.createElement("button");

        button.textContent = "CONNECT";

        button.addEventListener("click", login);

        statusOverlay.appendChild(button);
    }
}

function stopSpinning() {
    vinyl.classList.remove("playing");
}


/* =====================================
   4. PKCE AUTHENTICATION
===================================== */

function randomString(length = 64) {

    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

    const values = crypto.getRandomValues(
        new Uint8Array(length)
    );

    return Array.from(
        values,
        v => chars[v % chars.length]
    ).join("");
}

function base64URL(buffer) {

    return btoa(
        String.fromCharCode(...new Uint8Array(buffer))
    )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(value) {

    const data = new TextEncoder().encode(value);

    return crypto.subtle.digest("SHA-256", data);
}

async function login() {

    if (!crypto.subtle) {
        showStatus("Secure connection required");
        return;
    }

    const verifier = randomString();

    const challenge = base64URL(
        await sha256(verifier)
    );

    const state = randomString(32);

    sessionStorage.setItem(
        "spotify_verifier", verifier
    );

    sessionStorage.setItem(
        "spotify_state", state
    );

    const params = new URLSearchParams({

        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        state: state,
        code_challenge_method: "S256",
        code_challenge: challenge

    });

    window.location.href =
        AUTH_URL + "?" + params.toString();
}


/* =====================================
   5. TOKEN MANAGEMENT
===================================== */

function saveTokens(data) {

    accessToken = data.access_token;

    if (data.refresh_token) {

        refreshToken = data.refresh_token;

        localStorage.setItem(
            "spotify_refresh", refreshToken
        );
    }

    expiresAt =
        Date.now() + data.expires_in * 1000;
}


async function exchangeCode(code) {

    const verifier =
        sessionStorage.getItem("spotify_verifier");

    if (!verifier) {
        throw new Error("Missing PKCE verifier");
    }

    const body = new URLSearchParams({

        client_id: CLIENT_ID,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier

    });

    try {

        const response = await fetch(TOKEN_URL, {

            method: "POST",

            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded"
            },

            body: body

        });

        if (!response.ok) {

            throw new Error(
                "Login failed: " + response.status
            );
        }

        const data = await response.json();

        saveTokens(data);

    } finally {

        sessionStorage.removeItem("spotify_verifier");
        sessionStorage.removeItem("spotify_state");

        window.history.replaceState(
            {},
            document.title,
            window.location.pathname
        );
    }
}


async function refreshAccessToken() {

    refreshToken =
        localStorage.getItem("spotify_refresh");

    if (!refreshToken) {

        stopSpinning();

        showStatus("Connect Spotify", true);

        return false;
    }

    const body = new URLSearchParams({

        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken

    });

    const response = await fetch(TOKEN_URL, {

        method: "POST",

        headers: {
            "Content-Type":
                "application/x-www-form-urlencoded"
        },

        body: body

    });

    if (!response.ok) {

        if (response.status === 400 ||
            response.status === 401) {

            localStorage.removeItem("spotify_refresh");

            refreshToken = null;
            accessToken = null;

            stopSpinning();

            showStatus("Session expired", true);

            return false;
        }

        throw new Error(
            "Token refresh failed: " + response.status
        );
    }

    const data = await response.json();

    saveTokens(data);

    return true;
}


async function ensureToken() {

    if (!accessToken ||
        Date.now() >= expiresAt - 60000) {

        return await refreshAccessToken();
    }

    return true;
}


/* =====================================
   6. SPOTIFY API REQUEST
===================================== */

async function spotifyRequest() {

    const valid = await ensureToken();

    if (!valid) return null;

    let response = await fetch(API_URL, {

        headers: {
            Authorization: "Bearer " + accessToken
        }

    });

    if (response.status === 401) {

        accessToken = null;

        const refreshed = await refreshAccessToken();

        if (!refreshed) return null;

        response = await fetch(API_URL, {

            headers: {
                Authorization: "Bearer " + accessToken
            }

        });
    }

    return response;
}


/* =====================================
   7. ALBUM ARTWORK MANAGEMENT
===================================== */

function updateArtwork(item) {

    if (!item) return;

    const trackId = item.id || item.uri;

    if (!trackId || trackId === currentTrackId) {
        return;
    }

    const images =
        item.album?.images ||
        item.images ||
        item.show?.images ||
        [];

    if (!images.length) return;

    // Select the largest available image

    const bestImage = [...images].sort(
        (a, b) =>
            (b.width || 0) - (a.width || 0)
    )[0];

    if (!bestImage?.url) return;

    // Prevent an older image loading after a newer track

    const requestId = ++artworkRequest;

    const tempImg = new Image();

    tempImg.onload = () => {

        if (requestId !== artworkRequest) return;

        album.src = bestImage.url;

        album.classList.add("loaded");

        currentTrackId = trackId;
    };

    tempImg.onerror = () => {

        if (requestId !== artworkRequest) return;

        console.warn("Album artwork failed to load");
    };

    tempImg.src = bestImage.url;
}


/* =====================================
   8. PLAYBACK DETECTION
===================================== */

async function checkSpotify() {

    if (polling) return POLL_INTERVAL;

    polling = true;

    let nextDelay = POLL_INTERVAL;

    try {

        const response = await spotifyRequest();

        // Authentication unavailable

        if (!response) {
            return 0;
        }

        // Nothing currently playing

        if (response.status === 204) {

            stopSpinning();

            showStatus("Spotify idle");

            return nextDelay;
        }

        // Spotify rate limiting

        if (response.status === 429) {

            nextDelay =
                (Number(
                    response.headers.get("Retry-After")
                ) || 10) * 1000;

            return nextDelay;
        }

        if (!response.ok) {

            throw new Error(
                "Spotify API error: " + response.status
            );
        }

        const data = await response.json();

        const item = data.item;

        if (item) {

            updateArtwork(item);
        }

        // Playback status

        if (data.is_playing && item) {

            vinyl.classList.add("playing");

            showStatus("");

        } else {

            stopSpinning();

            showStatus("Paused");
        }

    } catch (error) {

        console.error("Spotify error:", error);

        stopSpinning();

        showStatus("Connection problem");

    } finally {

        polling = false;
    }

    return nextDelay;
}


/* =====================================
   9. AUTOMATIC POLLING
===================================== */

function scheduleNextCheck(delay = POLL_INTERVAL) {

    clearTimeout(pollTimer);

    if (!localStorage.getItem("spotify_refresh") &&
        !accessToken) {
        return;
    }

    pollTimer = setTimeout(async () => {

        const nextDelay = await checkSpotify();

        if (nextDelay > 0) {

            scheduleNextCheck(nextDelay);

        }

    }, delay);
}


/* =====================================
   10. INITIALISATION
===================================== */

async function initialise() {

    if (!CLIENT_ID ||
        CLIENT_ID === "YOUR_SPOTIFY_CLIENT_ID") {

        showStatus("Set your Spotify Client ID");

        return;
    }

    const params = new URLSearchParams(
        window.location.search
    );

    const code = params.get("code");

    const returnedState = params.get("state");

    const authError = params.get("error");

    // User rejected authorisation

    if (authError) {

        showStatus("Spotify access denied", true);

        return;
    }

    // Complete authentication

    if (code) {

        const savedState =
            sessionStorage.getItem("spotify_state");

        if (!savedState ||
            returnedState !== savedState) {

            showStatus("Authentication error", true);

            return;
        }

        try {

            await exchangeCode(code);

        } catch (error) {

            console.error(error);

            showStatus("Login failed - reconnect", true);

            return;
        }
    }

    // Check for an existing session

    else if (!localStorage.getItem("spotify_refresh")) {

        showStatus("Connect Spotify", true);

        return;
    }

    showStatus("Connecting...");

    const nextDelay = await checkSpotify();

    if (nextDelay > 0) {

        scheduleNextCheck(nextDelay);

    }
}


/* =====================================
   11. START DISPLAY
===================================== */

initialise().catch(error => {

    console.error("Initialisation failed:", error);

    stopSpinning();

    showStatus("Unable to connect", true);

});
