// =====================================================================
// Sales Companion server
//
// What this file does:
// 1. Verifies "Sign in with Google" tokens sent from the browser.
// 2. Checks the signed-in email against approved-users.js.
// 3. Issues a simple signed session cookie so the browser stays
//    "logged in" without re-verifying Google every request.
// 4. Stores your uploaded documents in a Gemini File Search store.
// 5. Proxies every chat/coach/practice/test message to Gemini, with
//    File Search turned on, so answers are grounded ONLY in what you
//    uploaded — never the model's general/invented knowledge, and
//    your Gemini API key never reaches the browser.
// =====================================================================

const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { OAuth2Client } = require("google-auth-library");
const fetch = require("node-fetch");

const { isApproved } = require("./approved-users");

// ---------------------------------------------------------------------
// CONFIG — these come from environment variables you set on Render
// (see README for exactly where to paste each one). Nothing secret is
// hardcoded in this file.
// ---------------------------------------------------------------------
const PORT = process.env.PORT || 3001;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const GEMINI_MODEL = "gemini-2.5-flash";

// IMPORTANT: this is read from an environment variable, NOT a local file.
// Free hosting tiers (like Render's free instance) wipe local disk on
// every redeploy or spin-down/wake cycle. If the store name lived in a
// local file, every wake-up would silently create a brand-new, empty
// File Search store and your uploaded documents would appear to vanish.
// Instead: the FIRST time you run this server, it creates the store and
// prints the name to the logs — copy that into a FILE_SEARCH_STORE_NAME
// environment variable on Render so every future restart reuses the
// same store. See README for the exact steps.
let FILE_SEARCH_STORE_NAME = process.env.FILE_SEARCH_STORE_NAME || "";

const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const upload = multer({ dest: path.join(__dirname, "uploads") });
if (!fs.existsSync(path.join(__dirname, "uploads"))) {
  fs.mkdirSync(path.join(__dirname, "uploads"));
}

// ---------------------------------------------------------------------
// Tiny signed-cookie session (no database needed).
// ---------------------------------------------------------------------
function sign(value) {
  const h = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  return `${value}.${h}`;
}
function unsign(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  return value;
}

function requireSession(req, res, next) {
  const raw = req.cookies && req.cookies.session;
  const email = unsign(raw);
  if (!email || !isApproved(email)) {
    return res.status(401).json({ error: "Not signed in or not approved." });
  }
  req.userEmail = email;
  next();
}

// ---------------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------------

// Browser sends the Google ID token here after the Sign in with Google
// button completes.
app.post("/api/auth/google", async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: "Missing idToken." });
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: "Server is missing GOOGLE_CLIENT_ID." });

  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = payload && payload.email;
    const emailVerified = payload && payload.email_verified;

    if (!email || !emailVerified) {
      return res.status(401).json({ error: "Google account email is not verified." });
    }
    if (!isApproved(email)) {
      return res.status(403).json({ error: "This email is not on the approved list yet. Ask the app owner to add you." });
    }

    const sessionValue = sign(email);
    res.cookie("session", sessionValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
    });
    res.json({ ok: true, email, name: payload.name || email, picture: payload.picture || null });
  } catch (err) {
    console.error("Google token verification failed:", err.message);
    res.status(401).json({ error: "Could not verify Google sign-in. Try again." });
  }
});

app.get("/api/auth/me", (req, res) => {
  const raw = req.cookies && req.cookies.session;
  const email = unsign(raw);
  if (!email || !isApproved(email)) return res.json({ signedIn: false });
  res.json({ signedIn: true, email });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// FILE SEARCH STORE — created once, reused for every upload + query.
// ---------------------------------------------------------------------
async function getOrCreateFileSearchStore() {
  if (FILE_SEARCH_STORE_NAME) return FILE_SEARCH_STORE_NAME;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/fileSearchStores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify({ displayName: "sales-companion-knowledge" }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create File Search store: ${res.status} ${text}`);
  }
  const data = await res.json();
  FILE_SEARCH_STORE_NAME = data.name;

  console.log("=".repeat(70));
  console.log("Created a new File Search store:", FILE_SEARCH_STORE_NAME);
  console.log("IMPORTANT: add this as an environment variable on Render so it");
  console.log("survives restarts. Variable name: FILE_SEARCH_STORE_NAME");
  console.log("Variable value:", FILE_SEARCH_STORE_NAME);
  console.log("Without this, every restart will create a new empty store and");
  console.log("your previously uploaded documents will stop being searchable.");
  console.log("=".repeat(70));

  return FILE_SEARCH_STORE_NAME;
}

// ---------------------------------------------------------------------
// DOCUMENT UPLOAD — adds a file to the File Search store so Gemini can
// search it later. This is the ONLY source of factual knowledge the
// agent uses; nothing is invented or pulled from general training data
// for company-specific questions, by instruction (see SYSTEM_INSTRUCTIONS).
// ---------------------------------------------------------------------
app.post("/api/knowledge/upload", requireSession, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  try {
    const storeName = await getOrCreateFileSearchStore();
    const fileBuffer = fs.readFileSync(req.file.path);

    // Step 1: upload the raw file to Gemini's File API.
    // Official REST path: POST /v1beta/files (NOT /v1beta/{store}/files:upload —
    // that uploadToFileSearchStore convenience path is SDK-only; the two-step
    // upload-then-import flow below is the documented REST equivalent).
    const uploadRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
          "X-Goog-Upload-Protocol": "raw",
          "Content-Type": req.file.mimetype || "application/octet-stream",
          "X-Goog-Upload-File-Name": req.file.originalname,
        },
        body: fileBuffer,
      }
    );
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      throw new Error(`File upload failed: ${uploadRes.status} ${text}`);
    }
    const uploaded = await uploadRes.json();
    const fileName = uploaded.file && uploaded.file.name;

    // Step 2: import that uploaded file into the File Search store
    // (this triggers chunking + embeddings). Official REST path nests
    // files:import UNDER the store resource: /v1beta/{store}/files:import
    // This is a LONG-RUNNING operation — Gemini returns immediately with
    // an operation handle, not a finished result, so we poll until done.
    const importRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${storeName}/files:import`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({ fileName, displayName: req.file.originalname }),
      }
    );
    if (!importRes.ok) {
      const text = await importRes.text();
      throw new Error(`Import into File Search store failed: ${importRes.status} ${text}`);
    }
    let operation = await importRes.json();

    const maxAttempts = 30; // ~60 seconds total
    let attempts = 0;
    while (!operation.done && attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${operation.name}`,
        { headers: { "x-goog-api-key": GEMINI_API_KEY } }
      );
      if (!pollRes.ok) {
        const text = await pollRes.text();
        throw new Error(`Checking import status failed: ${pollRes.status} ${text}`);
      }
      operation = await pollRes.json();
      attempts++;
    }

    if (!operation.done) {
      // Indexing is taking longer than usual (large file) — it will
      // likely finish on its own; let the user know rather than block.
      fs.unlinkSync(req.file.path);
      return res.json({
        ok: true,
        displayName: req.file.originalname,
        note: "Still indexing in the background — it may take a minute or two before this document is searchable.",
      });
    }
    if (operation.error) {
      throw new Error(`Indexing failed: ${operation.error.message || JSON.stringify(operation.error)}`);
    }

    fs.unlinkSync(req.file.path); // clean up temp upload
    res.json({ ok: true, displayName: req.file.originalname });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// CHAT — every Learn / Practice / Coach / Test message comes through
// here. File Search is always on, so Gemini only answers company-
// specific questions using what you uploaded.
// ---------------------------------------------------------------------
const SYSTEM_INSTRUCTIONS = `You are "Sales Coach," an AI assistant for B2B sales reps. You operate in four modes: Learn, Practice, Coach, and Test. Figure out which mode the rep wants from their message. If it's obvious (e.g. "quiz me" = Test, "help me prep for my call" = Coach, "teach me about X" = Learn, "let's roleplay" = Practice), start that mode directly. If ambiguous, ask briefly which mode they want.

LEARN MODE: Teach a topic (industry, competitor, product area, persona) in 3-5 short paragraphs, like an experienced colleague explaining it over coffee. End with one example sentence the rep could say to a prospect, and offer a next step.

PRACTICE MODE: Roleplay as a skeptical prospect. Ask the rep for the scenario (sales stage, industry, difficulty) if not given. Stay fully in character until the rep says "stop" or "how did I do," then break character and give feedback: one thing that worked, one thing to improve, one better line they could have used.

COACH MODE: Ask for deal context if not given (company, industry, competitors, what's happened so far). Give a tailored brief: one sentence on the situation, one sentence on the angle to lead with, one ready-to-say line. Keep it under 150 words.

TEST MODE: Ask which topic. Ask one scenario-based question at a time (describe what a prospect said, ask what the rep would do). Wait for their answer, then give a verdict and one-sentence reason. After 5 questions, give a score out of 5 and the top area to practice next.

CRITICAL — grounding rule: you have a search tool connected to the company's own uploaded documents. For any factual claim about this company's product, pricing, features, competitors, or customers, you MUST rely only on what the search tool returns. If the search tool returns nothing relevant to the question, say plainly that this isn't covered in the uploaded materials yet — do not guess, invent, or fall back on general knowledge about sales or business. General sales technique and roleplay performance (not company facts) can still draw on your own reasoning. Tone: sharp, encouraging colleague, short sentences, no corporate filler.`;

app.post("/api/chat", requireSession, async (req, res) => {
  const { messages, dealContext } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Missing messages array." });
  }
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  try {
    const storeName = await getOrCreateFileSearchStore();

    let contextPrefix = "";
    if (dealContext) {
      contextPrefix = `[Deal context — do not mention this prefix, just use it]: The rep is currently working on ${dealContext.name}. ${dealContext.notes || ""}\n\n`;
    }

    const contents = messages.map((m, i) => {
      let text = m.text;
      if (i === messages.length - 1 && m.role === "user" && contextPrefix) {
        text = contextPrefix + text;
      }
      return { role: m.role === "assistant" ? "model" : "user", parts: [{ text }] };
    });

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTIONS }] },
          tools: [{ fileSearch: { fileSearchStoreNames: [storeName] } }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const text = await geminiRes.text();
      console.error("Gemini error:", geminiRes.status, text);
      return res.status(502).json({ error: `Gemini API error (status ${geminiRes.status}). Check server logs.` });
    }

    const data = await geminiRes.json();
    const text =
      (data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts.map(p => p.text).join("")) ||
      "I didn't get a usable response back. Try rephrasing your question.";

    res.json({ text });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// Serve the frontend
// ---------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`Sales Companion server running on port ${PORT}`);
});
