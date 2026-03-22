/**
 * Aladin Auth0 Integration
 * 
 * Uses Authorization Code Flow with PKCE via chrome.identity.launchWebAuthFlow.
 * Configure AUTH0_DOMAIN and AUTH0_CLIENT_ID in config.js or via
 * ALADIN_SAVE_AUTH_CONFIG message.
 */
const AladinAuth = (function () {
  let _accessToken = null;
  let _tokenExpiry = 0;
  let _userInfo = null;

  async function getAuthConfig() {
    const result = await chrome.storage.local.get([
      "auth0_domain",
      "auth0_client_id",
      "auth0_audience",
    ]);
    return {
      domain: result.auth0_domain || "",
      clientId: result.auth0_client_id || "",
      audience: result.auth0_audience || "https://api.aladin.finance",
    };
  }

  async function saveAuthConfig(config) {
    await chrome.storage.local.set({
      auth0_domain: config.domain,
      auth0_client_id: config.clientId,
      auth0_audience: config.audience || "https://api.aladin.finance",
    });
  }

  function generateRandomBytes(length) {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return arr;
  }

  function base64UrlEncode(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let str = "";
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return crypto.subtle.digest("SHA-256", data);
  }

  async function login() {
    const cfg = await getAuthConfig();
    if (!cfg.domain || !cfg.clientId) {
      throw new Error("Auth0 not configured. Set domain and clientId first.");
    }

    const redirectUrl = chrome.identity.getRedirectURL("auth0");
    const verifier = base64UrlEncode(generateRandomBytes(32));
    const challengeBuffer = await sha256(verifier);
    const codeChallenge = base64UrlEncode(challengeBuffer);

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: redirectUrl,
      response_type: "code",
      scope: "openid profile email",
      audience: cfg.audience,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authUrl = `https://${cfg.domain}/authorize?${params.toString()}`;

    const callbackUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl, interactive: true },
        (responseUrl) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          resolve(responseUrl);
        }
      );
    });

    const url = new URL(callbackUrl);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("No authorization code received");

    const tokenResponse = await fetch(`https://${cfg.domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: cfg.clientId,
        code_verifier: verifier,
        code: code,
        redirect_uri: redirectUrl,
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${errText}`);
    }

    const tokens = await tokenResponse.json();
    _accessToken = tokens.access_token;
    _tokenExpiry = Date.now() + (tokens.expires_in || 3600) * 1000;

    if (tokens.id_token) {
      try {
        const payload = JSON.parse(atob(tokens.id_token.split(".")[1]));
        _userInfo = {
          sub: payload.sub,
          email: payload.email,
          name: payload.name || payload.nickname,
          picture: payload.picture,
        };
      } catch {}
    }

    await chrome.storage.local.set({
      auth0_logged_in: true,
      auth0_user: _userInfo,
    });

    return { accessToken: _accessToken, user: _userInfo };
  }

  async function logout() {
    const cfg = await getAuthConfig();
    _accessToken = null;
    _tokenExpiry = 0;
    _userInfo = null;
    await chrome.storage.local.remove(["auth0_logged_in", "auth0_user"]);

    if (cfg.domain && cfg.clientId) {
      const returnTo = chrome.identity.getRedirectURL("auth0");
      const logoutUrl = `https://${cfg.domain}/v2/logout?client_id=${cfg.clientId}&returnTo=${encodeURIComponent(returnTo)}`;
      try {
        await new Promise((resolve) => {
          chrome.identity.launchWebAuthFlow(
            { url: logoutUrl, interactive: false },
            () => resolve()
          );
        });
      } catch {}
    }

    return { success: true };
  }

  async function getAccessToken() {
    if (_accessToken && Date.now() < _tokenExpiry - 60000) {
      return _accessToken;
    }
    const result = await login();
    return result.accessToken;
  }

  async function getUser() {
    if (_userInfo) return _userInfo;
    const stored = await chrome.storage.local.get(["auth0_user"]);
    return stored.auth0_user || null;
  }

  async function isLoggedIn() {
    if (_accessToken && Date.now() < _tokenExpiry) return true;
    const stored = await chrome.storage.local.get(["auth0_logged_in"]);
    return !!stored.auth0_logged_in;
  }

  return {
    getAuthConfig,
    saveAuthConfig,
    login,
    logout,
    getAccessToken,
    getUser,
    isLoggedIn,
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.AladinAuth = AladinAuth;
}
