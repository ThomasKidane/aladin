# Aladin — AI Financial Literacy Companion

A Chrome browser extension that understands any webpage you're browsing and provides real-time, personalized financial guidance — powered by [OpenClaw](https://openclawlab.com) and Claude.

> *Built for the HackDuke "Code for Good" 2026 Finance Track.*

## What It Does

**Aladin** democratizes financial literacy by acting as a knowledgeable companion that's with you everywhere you browse:

- **Real-time financial analysis** — Reads loan terms, credit card offers, bank accounts, and investment products on any page
- **Plain-language explanations** — Translates APR, amortization, compound interest, and other jargon into simple terms
- **Predatory term detection** — Flags hidden fees, unfavorable conditions, and high-risk financial products
- **Product comparison** — Suggests better alternatives when you're evaluating financial products
- **Resource finder** — Identifies government assistance programs, grants, and resources for underbanked individuals
- **Budgeting guidance** — Provides personalized tips based on the financial context you're browsing
- **Screenshot analysis** — Capture and analyze any visual financial content (statements, charts, offers)

## Architecture

```
Chrome Extension (Manifest V3)
├── background.js          — Service worker, OpenClaw + Auth0 handlers
├── config.js              — Server URL configuration
├── scripts/
│   ├── auth0.js           — Auth0 PKCE authentication flow
│   ├── openclaw.js        — OpenClaw API integration layer
│   ├── accessibilityTree.js — Structured page understanding
│   └── agentVisualIndicator.js — Visual feedback during agent actions
├── content-scripts/
│   └── content.js         — Page injection, highlights, UI
└── Side Panel (React)     — Chat interface (Cmd+J / Alt+J)

Server (Node.js + Express)
├── Auth0 JWT validation   — Verifies tokens from the extension
├── OpenClaw proxy         — Routes AI requests to the gateway
├── Bedrock vision         — Handles screenshot/image analysis
└── Chat persistence       — In-memory message storage
```

## Setup

### Prerequisites

- Node.js >= 18
- Chrome browser
- An [Auth0](https://auth0.com) account (free tier works)
- An OpenClaw Gateway instance (or access to one)

### 1. Clone and install

```bash
git clone https://github.com/your-username/aladin.git
cd aladin
cp .env.example .env
npm install
```

### 2. Configure Auth0

1. Create a new **Single Page Application** in the [Auth0 Dashboard](https://manage.auth0.com)
2. In **Settings**, add to **Allowed Callback URLs**:
   ```
   https://<YOUR_EXTENSION_ID>.chromiumapp.org/auth0
   ```
   (You'll get the extension ID after loading it in Chrome)
3. In **Settings**, add to **Allowed Origins**:
   ```
   chrome-extension://<YOUR_EXTENSION_ID>
   ```
4. Create an **API** in Auth0 with identifier `https://api.aladin.finance` (or your choice)
5. Update your `.env`:
   ```
   AUTH0_DOMAIN=your-tenant.us.auth0.com
   AUTH0_CLIENT_ID=your-client-id
   AUTH0_AUDIENCE=https://api.aladin.finance
   ```

### 3. Configure the server

Edit `.env` with your OpenClaw Gateway details:

```
OPENCLAW_GATEWAY=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=your-token-here
```

For screenshot/vision support, add AWS Bedrock credentials:

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

### 4. Configure the extension

Edit `src/config.js` to point to your server:

```js
const ALADIN_CONFIG = {
  SERVER_URL: "http://your-server-url",
};
```

### 5. Load the extension

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `src/` directory
4. Note your extension ID and update Auth0 callback URLs (step 2)

### 6. Start the server

```bash
npm run server
```

### 7. Configure Auth0 in the extension

Open the browser DevTools console and run:

```js
chrome.runtime.sendMessage({
  type: "ALADIN_AUTH_SAVE_CONFIG",
  domain: "your-tenant.us.auth0.com",
  clientId: "your-client-id",
  audience: "https://api.aladin.finance"
}, console.log);
```

Then trigger login:

```js
chrome.runtime.sendMessage({ type: "ALADIN_AUTH_LOGIN" }, console.log);
```

## Usage

| Shortcut | Action |
|---|---|
| Cmd+J (Mac) / Alt+J | Toggle side panel |
| Cmd+E (Mac) / Ctrl+E | Toggle launcher |

Open the side panel and start chatting. Aladin automatically reads the page you're on and provides financial context.

### Example prompts

- "Is this loan a good deal?"
- "Explain the fees on this credit card page"
- "What's the APR and how does it compare to average rates?"
- "Are there any hidden fees I should know about?"
- "What government assistance programs might I qualify for?"

## API Messages

| Message Type | Description |
|---|---|
| `ALADIN_AUTH_LOGIN` | Trigger Auth0 login flow |
| `ALADIN_AUTH_LOGOUT` | Log out and clear tokens |
| `ALADIN_AUTH_GET_TOKEN` | Get current access token |
| `ALADIN_AUTH_STATUS` | Check if user is logged in |
| `ALADIN_AUTH_SAVE_CONFIG` | Save Auth0 domain/clientId/audience |
| `GEODO_SCREEN_CONTEXT` | Capture page + send to AI for analysis |
| `GEODO_OPENCLAW_CHAT` | Direct chat with OpenClaw |
| `GEODO_OPENCLAW_TOOL` | Invoke an OpenClaw tool |
| `GEODO_TEST_CONNECTION` | Test gateway connectivity |
| `GEODO_SAVE_CONFIG` | Save gateway URL, token, agent ID |

## Deployment

For production, deploy the server behind HTTPS (e.g., with Caddy):

```
your-domain.com {
    reverse_proxy /api/* 127.0.0.1:3001 {
        flush_interval -1
    }
    reverse_proxy /v1/* 127.0.0.1:18789
    reverse_proxy /tools/* 127.0.0.1:18789
    reverse_proxy 127.0.0.1:3001
}
```

## Tech Stack

- **Extension**: Chrome Manifest V3, React (side panel), Auth0 PKCE
- **Server**: Node.js, Express, JSON Web Token validation
- **AI**: OpenClaw Gateway, AWS Bedrock (Claude), Responses API
- **Auth**: Auth0 (Authorization Code Flow with PKCE)

## License

Built for HackDuke Code for Good 2026.
