/**
 * Aladin Extension Configuration
 * 
 * Change ALADIN_SERVER_URL to point to your deployment.
 * All other config is stored in chrome.storage.local and
 * can be set at runtime via ALADIN_SAVE_CONFIG messages.
 */
const ALADIN_CONFIG = {
  SERVER_URL: "http://localhost:3001",
};

if (typeof globalThis !== "undefined") {
  globalThis.ALADIN_CONFIG = ALADIN_CONFIG;
}
