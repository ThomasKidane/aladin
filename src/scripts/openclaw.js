/**
 * Aladin OpenClaw Integration Layer
 * 
 * Bridges the extension's screen understanding capabilities
 * (accessibility tree, screenshots, page content) with OpenClaw's
 * cloud-based AI agent running at the Gateway.
 */
const AladinOpenClaw = (function () {
  const DEFAULT_GATEWAY = (typeof globalThis !== "undefined" && globalThis.ALADIN_CONFIG && globalThis.ALADIN_CONFIG.SERVER_URL) || "http://localhost:3001";

  async function getConfig() {
    const result = await chrome.storage.local.get([
      "openclaw_gateway_url",
      "openclaw_api_token",
      "openclaw_agent_id",
    ]);
    return {
      gatewayUrl: result.openclaw_gateway_url || DEFAULT_GATEWAY,
      apiToken: result.openclaw_api_token || "",
      agentId: result.openclaw_agent_id || "main",
    };
  }

  function headers(token) {
    const h = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  async function chatCompletion(messages, opts = {}) {
    const cfg = await getConfig();
    const url = `${cfg.gatewayUrl}/v1/chat/completions`;
    const body = {
      model: "openclaw",
      messages,
      stream: !!opts.stream,
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        ...headers(cfg.apiToken),
        "x-openclaw-agent-id": cfg.agentId,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`OpenClaw ${resp.status}: ${await resp.text()}`);
    if (opts.stream) return resp.body;
    return resp.json();
  }

  async function invokeTool(tool, args = {}, opts = {}) {
    const cfg = await getConfig();
    const url = `${cfg.gatewayUrl}/tools/invoke`;
    const body = {
      tool,
      action: opts.action || "json",
      args,
      sessionKey: opts.sessionKey || "main",
      dryRun: !!opts.dryRun,
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: headers(cfg.apiToken),
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`OpenClaw tool ${resp.status}: ${await resp.text()}`);
    return resp.json();
  }

  async function captureScreenContext(tabId) {
    const [accessibilityResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (typeof window.__generateAccessibilityTree === "function") {
          return window.__generateAccessibilityTree("all", 10, 50000);
        }
        return { pageContent: document.body?.innerText?.substring(0, 10000) || "" };
      },
    });

    const tab = await chrome.tabs.get(tabId);

    return {
      url: tab.url,
      title: tab.title,
      pageContent: accessibilityResult?.result?.pageContent || "",
      viewport: accessibilityResult?.result?.viewport || {},
      timestamp: Date.now(),
    };
  }

  async function sendScreenContext(tabId, userMessage) {
    const context = await captureScreenContext(tabId);

    const systemPrompt = [
      "You are Aladin, an AI assistant that understands everything the user sees on their screen.",
      "Below is the structured accessibility tree and metadata of the page the user is currently viewing.",
      "",
      `URL: ${context.url}`,
      `Title: ${context.title}`,
      `Viewport: ${context.viewport.width}x${context.viewport.height}`,
      "",
      "Page content (accessibility tree):",
      context.pageContent,
    ].join("\n");

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage || "What am I looking at? Summarize this page." },
    ];

    return chatCompletion(messages, { stream: false });
  }

  async function streamScreenContext(tabId, userMessage) {
    const context = await captureScreenContext(tabId);

    const systemPrompt = [
      "You are Aladin, an AI assistant that understands everything the user sees on their screen.",
      "Below is the structured accessibility tree and metadata of the page the user is currently viewing.",
      "",
      `URL: ${context.url}`,
      `Title: ${context.title}`,
      `Viewport: ${context.viewport.width}x${context.viewport.height}`,
      "",
      "Page content (accessibility tree):",
      context.pageContent,
    ].join("\n");

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage || "What am I looking at? Summarize this page." },
    ];

    return chatCompletion(messages, { stream: true });
  }

  async function testConnection() {
    const cfg = await getConfig();
    try {
      const resp = await fetch(`${cfg.gatewayUrl}/tools/invoke`, {
        method: "POST",
        headers: headers(cfg.apiToken),
        body: JSON.stringify({
          tool: "sessions_list",
          action: "json",
          args: {},
        }),
      });
      return { ok: resp.ok, status: resp.status };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return {
    getConfig,
    chatCompletion,
    invokeTool,
    captureScreenContext,
    sendScreenContext,
    streamScreenContext,
    testConnection,
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.AladinOpenClaw = AladinOpenClaw;
}
