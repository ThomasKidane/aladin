const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

const app = express();
const PORT = process.env.PORT || 3001;

const OPENCLAW_GATEWAY = process.env.OPENCLAW_GATEWAY || "http://127.0.0.1:18789";
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID || "main";

// ─── Auth0 Configuration ─────────────────────────────────────────────
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || "";
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || "";
const AUTH0_ENABLED = !!(AUTH0_DOMAIN && AUTH0_AUDIENCE);

let jwksRsa = null;
if (AUTH0_ENABLED) {
  jwksRsa = jwksClient({
    jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
  });
}

function getSigningKey(header, callback) {
  jwksRsa.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

function verifyAuth0Token(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        audience: AUTH0_AUDIENCE,
        issuer: `https://${AUTH0_DOMAIN}/`,
        algorithms: ["RS256"],
      },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      }
    );
  });
}

function authMiddleware(req, res, next) {
  if (!AUTH0_ENABLED) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];
  verifyAuth0Token(token)
    .then((decoded) => {
      req.user = decoded;
      next();
    })
    .catch((err) => {
      console.error("Auth0 token verification failed:", err.message);
      res.status(401).json({ error: "Invalid token" });
    });
}

app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-openclaw-agent-id, X-Incognito-Mode");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ─── Auth0 info endpoint (public) ────────────────────────────────────
app.get("/api/auth/config", (req, res) => {
  res.json({
    auth0Enabled: AUTH0_ENABLED,
    domain: AUTH0_DOMAIN || null,
    clientId: process.env.AUTH0_CLIENT_ID || null,
    audience: AUTH0_AUDIENCE || null,
  });
});

// ─── Auth session ────────────────────────────────────────────────────
app.get("/api/auth/session", authMiddleware, (req, res) => {
  const user = req.user;
  res.json({
    isSignedIn: true,
    user: {
      id: user?.sub || "aladin-user",
      email: user?.email || "user@aladin.local",
      name: user?.name || "Aladin User",
      image: user?.picture || null,
      plan: "pro",
      trialMessageShown: true,
      onboardingComplete: true,
    },
  });
});

app.get("/api/auth/integrations/status", (req, res) => res.json([]));
app.post("/api/user/mark-trial-message-shown", (req, res) => res.json({ success: true }));

// ─── Version ─────────────────────────────────────────────────────────
app.get("/aladin-version.json", (req, res) => {
  res.json({ version: "1.0.0", breakingMinVersion: "0.0.1" });
});
app.get("/dex-version.json", (req, res) => {
  res.json({ version: "1.0.0", breakingMinVersion: "0.0.1" });
});

// ─── AI Chat (stream through OpenClaw) ───────────────────────────────
const chatMessages = new Map();

function buildSystemPrompt(pageContext) {
  let s = `You are Aladin, an AI-powered financial literacy and empowerment companion built as a browser extension. Your mission is to help everyone — especially underbanked and financially underserved communities — make smarter, more informed financial decisions.

CORE CAPABILITIES:
- Analyze any webpage the user is browsing for financial content (loan terms, credit card offers, bank accounts, investment products, etc.)
- Explain complex financial jargon in simple, accessible language
- Flag predatory lending practices, hidden fees, and unfavorable terms
- Compare financial products and suggest better alternatives
- Provide personalized budgeting tips and financial literacy education
- Help users understand their rights as consumers
- Identify government assistance programs, grants, and resources for underbanked individuals

PERSONALITY:
- Warm, approachable, and non-judgmental — never make users feel bad about their financial situation
- Use analogies and real-world examples to explain complex concepts
- Be proactive: if you see something concerning on a page, flag it
- Always empower users with knowledge, never just tell them what to do

IMPORTANT: Respond ONLY in the side panel chat. Do NOT type into the webpage.

FORMATTING RULES:
- Use **bold** for emphasis and important terms
- Use markdown headers (##, ###) to organize long responses
- Use bullet points and numbered lists for collections of items
- Use tables when presenting structured data (great for comparing financial products)
- Use \`code\` for technical terms, filenames, and commands
- Use > blockquotes for important warnings about predatory terms or red flags
- Add blank lines between sections for readability
- When analyzing financial products, always include a simple PROS/CONS breakdown`;

  if (pageContext) {
    s += "\n\n--- CURRENT PAGE CONTEXT ---";
    if (pageContext.url) s += `\nURL: ${pageContext.url}`;
    if (pageContext.title) s += `\nTitle: ${pageContext.title}`;
    if (pageContext.content) s += `\nPage content:\n${pageContext.content.substring(0, 30000)}`;
  }
  return s;
}

function extractFromParts(parts) {
  let text = "";
  let images = [];
  let annotations = "";

  for (const p of parts || []) {
    if (p.type === "text") text += p.text || "";
    else if (p.type === "image_url" && p.image_url?.url) images.push(p.image_url.url);
    else if (p.type === "data-annotations") annotations += p.content || "";
  }
  return { text, images, annotations };
}

function extractStepLabel(text) {
  const sentences = text.split(/[.!?\n]/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    if (/\b(creat|generat|writ|analyz|extract|fetch|process|build|search|pars|download|compar|calculat)/i.test(s)) {
      return s.length > 80 ? s.substring(0, 77) + "..." : s;
    }
  }
  return sentences[0]?.substring(0, 80) || "Processing...";
}

app.post("/api/ai/chat", authMiddleware, async (req, res) => {
  try {
    const rawMessages = req.body.messages || [];
    const chatId = req.body.chatId || crypto.randomUUID();

    if (!chatMessages.has(chatId)) chatMessages.set(chatId, []);
    const stored = chatMessages.get(chatId);

    let userText = "";
    let images = [];
    let pageContext = null;

    const lastMsg = rawMessages[rawMessages.length - 1];
    if (lastMsg) {
      if (lastMsg.parts) {
        const extracted = extractFromParts(lastMsg.parts);
        userText = extracted.text;
        images = extracted.images;
        if (extracted.annotations) {
          pageContext = { content: extracted.annotations };
        }
      } else {
        userText = typeof lastMsg.content === "string" ? lastMsg.content : JSON.stringify(lastMsg.content);
      }
    }

    if (req.body.pageContext) pageContext = req.body.pageContext;

    stored.push({
      id: crypto.randomUUID(),
      role: "user",
      content: userText,
      parts: [{ type: "text", text: userText }],
      created_at: new Date().toISOString(),
    });

    const systemPrompt = buildSystemPrompt(pageContext);

    // Build Responses API input
    const responsesInput = [];
    for (const m of stored) {
      if (m.role === "user" && m.content) {
        responsesInput.push({ role: "user", content: m.content });
      } else if (m.role === "assistant" && m.content) {
        responsesInput.push({ role: "assistant", content: m.content });
      }
    }

    const assistantMsgId = crypto.randomUUID();
    const textPartId = crypto.randomUUID();
    const toolPartId = crypto.randomUUID();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (res.socket) res.socket.setNoDelay(true);

    function sse(type, props) {
      return `data: ${JSON.stringify({ type, properties: props })}\n\n`;
    }

    // Send initial message structure
    res.write(
      sse("message.updated", {
        message: {
          id: assistantMsgId,
          role: "assistant",
          created_at: new Date().toISOString(),
          parts: [
            { id: toolPartId, type: "tool", tool: "Analyzing...", state: "input-streaming" },
            { id: textPartId, type: "text", text: "" },
          ],
        },
        chatId,
        title: userText.substring(0, 50) || "Chat",
      })
    );

    await new Promise((r) => setTimeout(r, 500));

    // Handle vision requests via Bedrock
    if (images.length > 0 && process.env.AWS_ACCESS_KEY_ID) {
      const { BedrockRuntimeClient, ConverseStreamCommand } = require("@aws-sdk/client-bedrock-runtime");
      const bedrock = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || "us-east-1",
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });

      const contentBlocks = [];
      for (const imgUrl of images) {
        const match = imgUrl.match(/^data:image\/(png|jpeg|gif|webp);base64,(.+)$/);
        if (match) {
          contentBlocks.push({
            image: { format: match[1] === "jpg" ? "jpeg" : match[1], source: { bytes: Buffer.from(match[2], "base64") } },
          });
        }
      }
      contentBlocks.push({ text: userText || "What do you see in this image?" });

      const cmd = new ConverseStreamCommand({
        modelId: "us.anthropic.claude-opus-4-6-v1",
        messages: [{ role: "user", content: contentBlocks }],
        system: [{ text: systemPrompt }],
      });

      const response = await bedrock.send(cmd);
      let fullText = "";
      for await (const event of response.stream) {
        if (event.contentBlockDelta?.delta?.text) {
          const chunk = event.contentBlockDelta.delta.text;
          fullText += chunk;
          res.write(sse("message.part.updated", { chatId, messageId: assistantMsgId, part: { id: textPartId, type: "text", text: fullText } }));
        }
      }

      res.write(sse("message.part.updated", { chatId, messageId: assistantMsgId, part: { id: toolPartId, type: "tool", tool: "Done", state: "step-finish" } }));
      stored.push({ id: assistantMsgId, role: "assistant", content: fullText, parts: [{ type: "text", text: fullText }], created_at: new Date().toISOString() });
      res.end();
      return;
    }

    // Standard text: use OpenClaw Responses API
    const body = {
      model: "openclaw",
      instructions: systemPrompt,
      input: responsesInput,
      stream: true,
    };

    const ocRes = await fetch(`${OPENCLAW_GATEWAY}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENCLAW_TOKEN}`,
        "x-openclaw-agent-id": OPENCLAW_AGENT_ID,
      },
      body: JSON.stringify(body),
    });

    if (!ocRes.ok) {
      const errText = await ocRes.text();
      console.error("OpenClaw error:", ocRes.status, errText);
      res.write(sse("error", { error: { message: `AI service error: ${ocRes.status}`, type: "server_error" } }));
      res.end();
      return;
    }

    const reader = ocRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let labelSent = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const ev = JSON.parse(data);

          if (ev.type === "response.output_text.delta" && ev.delta) {
            fullText += ev.delta;
            res.write(sse("message.part.updated", { chatId, messageId: assistantMsgId, part: { id: textPartId, type: "text", text: fullText } }));

            if (!labelSent && fullText.length > 40) {
              const label = extractStepLabel(fullText);
              res.write(sse("message.part.updated", { chatId, messageId: assistantMsgId, part: { id: toolPartId, type: "tool", tool: label, state: "input-streaming" } }));
              labelSent = true;
            }
          }

          // Handle chat-completions fallback format
          if (ev.choices?.[0]?.delta?.content) {
            const delta = ev.choices[0].delta.content;
            fullText += delta;
            res.write(sse("message.part.updated", { chatId, messageId: assistantMsgId, part: { id: textPartId, type: "text", text: fullText } }));
          }
        } catch {}
      }
    }

    res.write(sse("message.part.updated", { chatId, messageId: assistantMsgId, part: { id: toolPartId, type: "tool", tool: "Done", state: "step-finish" } }));

    stored.push({
      id: assistantMsgId,
      role: "assistant",
      content: fullText,
      parts: [{ type: "text", text: fullText }],
      created_at: new Date().toISOString(),
    });

    res.end();
  } catch (err) {
    console.error("Chat error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

// ─── AI Tool execution ───────────────────────────────────────────────
app.post("/api/ai/tool", authMiddleware, async (req, res) => {
  try {
    const ocRes = await fetch(`${OPENCLAW_GATEWAY}/tools/invoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENCLAW_TOKEN}`,
      },
      body: JSON.stringify({
        tool: req.body.toolName || "sessions_list",
        action: "json",
        args: req.body.args || {},
        sessionKey: "main",
      }),
    });
    const data = await ocRes.json();
    res.json(data);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─── AI Suggestions ──────────────────────────────────────────────────
app.post("/api/ai/suggestions", (req, res) => {
  res.json({
    suggestions: [
      { text: "Is this loan a good deal?" },
      { text: "Explain the fees on this page" },
      { text: "Compare this to similar products" },
    ],
  });
});

// ─── AI Feedback ─────────────────────────────────────────────────────
app.post("/api/ai/feedback", (req, res) => res.json({ success: true }));
app.post("/api/ai/clipboard", (req, res) => res.json({ content: "" }));
app.post("/api/ai/history", (req, res) => res.json({ success: true }));
app.post("/api/ai/interactions", (req, res) => res.json({ success: true }));
app.post("/api/ai/workflowsuggestion", (req, res) => res.json({ suggestions: [] }));

// ─── Chat History ────────────────────────────────────────────────────
app.get("/api/chat/list", (req, res) => {
  const chats = [];
  for (const [id, msgs] of chatMessages.entries()) {
    if (msgs.length > 0) {
      chats.push({
        id,
        title: msgs[0]?.content?.substring(0, 50) || "Chat",
        created_at: msgs[0]?.created_at,
        updated_at: msgs[msgs.length - 1]?.created_at,
      });
    }
  }
  res.json({ chats: chats.reverse(), has_more: false });
});

app.get("/api/chat", (req, res) => {
  const chatId = req.query.chatId;
  const msgs = chatMessages.get(chatId) || [];
  res.json(msgs);
});

app.patch("/api/chat/:id", (req, res) => res.json({ success: true }));
app.delete("/api/chat/:id", (req, res) => {
  chatMessages.delete(req.params.id);
  res.json({ success: true });
});

// ─── Runs ────────────────────────────────────────────────────────────
app.get("/api/runs", (req, res) => res.json([]));

// ─── Tasks ───────────────────────────────────────────────────────────
app.get("/api/task", (req, res) => {
  if (req.query.id) return res.json({ id: req.query.id, title: "", is_active: false });
  res.json([]);
});
app.post("/api/task", (req, res) => {
  res.json({ id: crypto.randomUUID(), ...req.body, created_at: new Date().toISOString() });
});
app.patch("/api/task", (req, res) => res.json({ success: true }));
app.post("/api/task/name", (req, res) => res.json({ name: "New Task" }));
app.post("/api/task/sort", (req, res) => res.json({ success: true }));
app.post("/api/task/group", (req, res) => res.json({ groups: [] }));

// ─── Automations ─────────────────────────────────────────────────────
app.get("/api/automations", (req, res) => res.json([]));
app.delete("/api/automations/:id", (req, res) => res.json({ success: true }));

// ─── Snippets ────────────────────────────────────────────────────────
app.get("/api/snippets/documents", (req, res) => res.json([]));
app.get("/api/snippets/folders", (req, res) => res.json([]));

// ─── Skills / Shortcuts / Tabs ───────────────────────────────────────
app.get("/api/skills", (req, res) => res.json([]));
app.get("/api/shortcuts", (req, res) => res.json([]));
app.post("/api/tabs/tidy", (req, res) => res.json({ groups: [] }));

// ─── Notification ────────────────────────────────────────────────────
app.post("/api/notification", (req, res) => res.json({ success: true }));

// ─── Feature flags (stub) ───────────────────────────────────────────
app.post("/flags/", (req, res) => res.json({ featureFlags: {} }));
app.get("/api/early_access_features/", (req, res) => res.json({ earlyAccessFeatures: [] }));
app.get("/api/surveys/", (req, res) => res.json({ surveys: [] }));
app.get("/api/product_tours/", (req, res) => res.json({ tours: [] }));
app.get("/api/web_experiments/", (req, res) => res.json({ experiments: [] }));

// ─── Catch-all for unknown API routes ────────────────────────────────
app.all("/api/{*path}", (req, res) => {
  console.log(`[stub] ${req.method} ${req.path}`);
  res.json({ success: true });
});

// ─── OpenClaw gateway proxy (pass-through) ───────────────────────────
app.all("/v1/{*path}", authMiddleware, async (req, res) => {
  try {
    const ocRes = await fetch(`${OPENCLAW_GATEWAY}${req.path}`, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENCLAW_TOKEN}`,
        "x-openclaw-agent-id": req.headers["x-openclaw-agent-id"] || OPENCLAW_AGENT_ID,
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    const data = await ocRes.text();
    res.status(ocRes.status).type("application/json").send(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.all("/tools/{*path}", authMiddleware, async (req, res) => {
  try {
    const ocRes = await fetch(`${OPENCLAW_GATEWAY}${req.path}`, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENCLAW_TOKEN}`,
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    const data = await ocRes.text();
    res.status(ocRes.status).type("application/json").send(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── Files (serve OpenClaw workspace files) ──────────────────────────
const path = require("path");
const fs = require("fs");
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME || "/tmp", ".openclaw/workspace");
if (fs.existsSync(WORKSPACE_DIR)) {
  app.use("/files", express.static(WORKSPACE_DIR));
}

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Aladin API server running on http://127.0.0.1:${PORT}`);
  console.log(`Auth0: ${AUTH0_ENABLED ? "enabled" : "disabled (set AUTH0_DOMAIN and AUTH0_AUDIENCE to enable)"}`);
});
