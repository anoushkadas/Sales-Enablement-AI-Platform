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
// Node 18+ ships a built-in fetch — no package needed, and unlike the
// node-fetch package, it doesn't have the known keep-alive socket bug
// that causes spurious "Premature close" errors when calling Google's
// APIs repeatedly from a long-running server (see node-fetch#1767).
if (typeof fetch !== "function") {
  throw new Error("This server requires Node 18 or newer (for built-in fetch). Check your Render Node version setting.");
}

const { isApproved } = require("./approved-users");
const db = require("./db");
const PptxGenJS = require("pptxgenjs");
const docx = require("docx");
const mammoth = require("mammoth");

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
// Preview model name — if Google renames/retires this, swap it here only.
const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

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
// exposedHeaders: Content-Disposition is not exposed to client-side JS
// by default per the CORS spec — needed so the Generate screen can read
// the real filename (AI-chosen or custom title) the server used, rather
// than guessing one from the topic text on the client side.
app.use(cors({ origin: true, credentials: true, exposedHeaders: ["Content-Disposition"] }));
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

// Use AFTER requireSession on routes only managers should reach.
async function requireManager(req, res, next) {
  try {
    const user = await db.getUser(req.userEmail);
    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "This action is only available to managers." });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: "Could not verify manager permissions." });
  }
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

    if (db.pool) {
      await db.upsertUserOnSignIn(email, payload.name || null);
      // Bootstrap rule: the FIRST email listed in approved-users.js is
      // automatically a manager the first time anyone signs in. This
      // solves the chicken-and-egg problem of "managers assign roles,
      // but someone has to be the first manager." Edit roles for
      // everyone else from the Manage Team screen once signed in.
      const { APPROVED_EMAILS } = require("./approved-users");
      const firstApprovedEmail = (APPROVED_EMAILS[0] || "").trim().toLowerCase();
      if (email.toLowerCase() === firstApprovedEmail) {
        const existing = await db.getUser(email);
        if (existing && existing.role !== "manager") {
          await db.setUserRole(email, "manager");
        }
      }
    }

    const sessionValue = sign(email);
    res.cookie("session", sessionValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
    });
    let role = "rep";
    if (db.pool) {
      const userRow = await db.getUser(email);
      if (userRow) role = userRow.role;
    }

    res.json({ ok: true, email, name: payload.name || email, picture: payload.picture || null, role });
  } catch (err) {
    console.error("Google token verification failed:", err.message);
    res.status(401).json({ error: "Could not verify Google sign-in. Try again." });
  }
});

app.get("/api/auth/me", async (req, res) => {
  const raw = req.cookies && req.cookies.session;
  const email = unsign(raw);
  if (!email || !isApproved(email)) return res.json({ signedIn: false });
  let role = "rep";
  if (db.pool) {
    try {
      const user = await db.getUser(email);
      if (user) role = user.role;
    } catch (err) {
      console.error("Could not load user role:", err.message);
    }
  }
  res.json({ signedIn: true, email, role });
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

    // Upload AND import in a single call. This is media.uploadToFileSearchStore
    // (ai.google.dev/api/file-search/file-search-stores) — it replaces the
    // separate files.upload + fileSearchStores.importFile two-step flow.
    //
    // We switched to this single-call method because importFile is
    // currently broken for the newer "AQ." auth-key format that Google
    // started issuing account-wide in June 2026 (confirmed: every other
    // File Search method, including this one, works fine with the same
    // key — only importFile rejects it with a 401). See:
    // https://discuss.ai.google.dev/t/gemini-file-search-importfile-file-id-path-fails-with-401-using-api-key/170022
    // If Google fixes importFile later, this single-call method still
    // works fine going forward — no need to revert.
    const uploadRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/${storeName}:uploadToFileSearchStore`,
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
      throw new Error(`Upload to File Search store failed: ${uploadRes.status} ${text}`);
    }
    let operation = await uploadRes.json();

    // This is a LONG-RUNNING operation — poll until done, same pattern
    // as the old importFile flow.
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
        throw new Error(`Checking upload status failed: ${pollRes.status} ${text}`);
      }
      operation = await pollRes.json();
      attempts++;
    }

    if (!operation.done) {
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

RESPONSE LENGTH RULE — always check this first: if the rep's message contains words like "quick", "briefly", "short", "tldr", "in a sentence", "summarise", "summarize", "one line", or "just tell me", give a SHORT response (2-4 sentences max, no lists, no headers, just the essential point). For all other messages, give a FULL detailed response with depth, examples, and reasoning — do not truncate or summarize a full answer just to save space.

LEARN MODE: Teach a topic (industry, competitor, product area, persona) in 3-5 short paragraphs, like an experienced colleague explaining it over coffee. End with one example sentence the rep could say to a prospect, and offer a next step.

PRACTICE MODE: Roleplay as a skeptical prospect. Ask the rep for the scenario (sales stage, industry, difficulty) if not given. Stay fully in character until the rep says "stop" or "how did I do," then break character and give feedback: one thing that worked, one thing to improve, one better line they could have used.

COACH MODE: Ask for deal context if not given (company, industry, competitors, what's happened so far). Give a tailored brief: one sentence on the situation, one sentence on the angle to lead with, one ready-to-say line. Keep it under 150 words.

TEST MODE: Ask which topic. Ask one scenario-based question at a time (describe what a prospect said, ask what the rep would do). Wait for their answer, then give a verdict and one-sentence reason. After 5 questions, give a score out of 5 and the top area to practice next.

CRITICAL — grounding rule: you have a search tool connected to the company's own uploaded documents. For any factual claim about this company's product, pricing, features, competitors, or customers, you MUST rely only on what the search tool returns or — if nothing relevant is found there — on the public Pure Storage / Everpure website content provided to you as a fallback source. Never guess, invent, or fall back on general knowledge about sales or business for company-specific facts. General sales technique and roleplay performance (not company facts) can still draw on your own reasoning. Tone: sharp, encouraging colleague, short sentences, no corporate filler.`;

// Phrases the model uses (per the instruction above) when File Search
// found nothing relevant — used to detect a "came up empty" response so
// we can retry once against the public website instead of just
// surfacing a flat refusal to the rep.
const GROUNDING_REFUSAL_PATTERNS = [
  "isn't covered in",
  "isn't covered by",
  "not covered in",
  "not covered by",
  "don't have that in",
  "doesn't appear to be covered",
];

function looksLikeGroundingRefusal(text) {
  const lower = (text || "").toLowerCase();
  return GROUNDING_REFUSAL_PATTERNS.some(p => lower.includes(p));
}

// NOTE: as of the ADK migration, /api/chat no longer calls
// looksLikeGroundingRefusal or retryWithWebsiteFallback directly — that
// logic now lives inside the searchPublicWebsite ADK tool
// (adk-website-fallback-tool.js), which the agent calls itself when it
// decides searchCompanyKnowledge came up empty. Left here, unused for
// now, since groundedDraft() (used by lesson plans, PPTX/DOCX
// generation, and Test mode) could reuse the same refusal-detection
// pattern later if those routes are ever migrated too.

// Public fallback source. File Search cannot be combined with the
// urlContext tool in the same call (confirmed: "File Search cannot be
// combined with other tools like Grounding with Google Search, URL
// Context, etc. at this time") — so this is a SEPARATE follow-up call,
// not an additional tool bolted onto the first one.
const COMPANY_WEBSITE_URLS = ["https://www.purestorage.com", "https://www.everpuredata.com"];

async function retryWithWebsiteFallback(contents) {
  const fallbackSystemInstructions = `You are "Sales Coach," continuing to help a B2B sales rep. The company's internal documents didn't have an answer to the rep's question, so you're now answering using the public Pure Storage / Everpure website (purestorage.com and everpuredata.com) instead. Ground every factual claim in what you find on those sites. If the site doesn't cover it either, say so plainly rather than guessing. Mention naturally that this came from the public website, not internal materials, so the rep knows the source. Keep the same tone: sharp, encouraging colleague, short sentences, no corporate filler.`;

  const promptWithUrls = `${COMPANY_WEBSITE_URLS.join(" and ")}\n\nUsing those sites, answer this: ${contents[contents.length - 1].parts[0].text}`;
  const fallbackContents = contents.slice(0, -1).concat([{ role: "user", parts: [{ text: promptWithUrls }] }]);

  const fallbackRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: fallbackContents,
        systemInstruction: { parts: [{ text: fallbackSystemInstructions }] },
        tools: [{ urlContext: {} }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      }),
    }
  );

  if (!fallbackRes.ok) return null;
  const fallbackData = await fallbackRes.json();
  const fallbackText =
    fallbackData.candidates &&
    fallbackData.candidates[0] &&
    fallbackData.candidates[0].content &&
    fallbackData.candidates[0].content.parts &&
    fallbackData.candidates[0].content.parts.map(p => p.text).join("");
  return fallbackText || null;
}

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
      const facts = [];
      facts.push(`Deal: ${dealContext.name}`);
      if (dealContext.company) facts.push(`Company: ${dealContext.company}`);
      if (dealContext.deal_owner) facts.push(`Deal owner: ${dealContext.deal_owner}`);
      if (dealContext.value) facts.push(`Value: $${Number(dealContext.value).toLocaleString()}`);
      if (dealContext.timeline_date) facts.push(`Target close date: ${dealContext.timeline_date}`);
      if (dealContext.priority) facts.push(`Priority: ${dealContext.priority}`);
      if (dealContext.status) facts.push(`Status: ${dealContext.status}`);
      if (Array.isArray(dealContext.people_involved) && dealContext.people_involved.length) {
        facts.push(`People involved: ${dealContext.people_involved.join(", ")}`);
      }
      if (dealContext.notes) facts.push(`Notes: ${dealContext.notes}`);
      contextPrefix = `[Deal context — do not mention this prefix, just use it naturally]: The rep is currently working on this deal. ${facts.join(". ")}. If relevant documents for this deal have been uploaded, search for them as you would any other knowledge.\n\n`;
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
      const errBody = await geminiRes.text();
      console.error("Gemini error:", geminiRes.status, errBody);
      return res.status(502).json({ error: `Gemini API error (status ${geminiRes.status}).` });
    }

    const data = await geminiRes.json();
    let text =
      (data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts.map(p => p.text).join("")) ||
      "I didn't get a usable response back. Try rephrasing your question.";

    if (looksLikeGroundingRefusal(text)) {
      try {
        const fallbackText = await retryWithWebsiteFallback(contents);
        if (fallbackText) text = fallbackText;
      } catch (fallbackErr) {
        console.error("Website fallback failed:", fallbackErr.message);
      }
    }

    if (db.pool) {
      const lastUserMessage = [...messages].reverse().find(m => m.role === "user");
      if (lastUserMessage) {
        const tag = dealContext ? "Deal" : "General";
        db.addHistoryEntry(req.userEmail, lastUserMessage.text, text, tag, dealContext && dealContext.id ? dealContext.id : null)
          .catch(err => console.error("Could not log history entry:", err.message));
      }
    }

    res.json({ text });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/chat/reset", requireSession, async (req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// PODCAST (text-to-speech) — turns a lesson's text into narrated audio.
//
// Gemini's TTS model returns raw PCM audio (24kHz, 16-bit, mono), not a
// ready-to-play file — every official example wraps it in a WAV header
// before it's playable in a browser <audio> tag. wrapPcmAsWav below does
// exactly that, by hand, with no audio library dependency.
// ---------------------------------------------------------------------
function wrapPcmAsWav(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = 1 (PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// Gemini TTS voices only speak what they're told to say — the prompt
// must explicitly instruct the model to read/narrate the text, or it
// may not produce audio at all. We also ask for a warm, podcast-host
// delivery rather than a flat reading.
function buildPodcastPrompt(lessonText) {
  return `Narrate the following sales training lesson aloud in a warm, engaging podcast-host voice — natural pacing, like you're walking a colleague through it over coffee, not reading a script flatly:\n\n${lessonText}`;
}

app.post("/api/podcast", requireSession, async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Missing lesson text to narrate." });
  }
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  // Rough safety cap: very long lessons cost more and risk hitting
  // model limits. Trim to something reasonable for a single narration.
  const trimmedText = text.length > 6000 ? text.slice(0, 6000) + "..." : text;

  try {
    const ttsRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPodcastPrompt(trimmedText) }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
            },
          },
        }),
      }
    );

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error("TTS error:", ttsRes.status, errText);
      return res.status(502).json({ error: `Gemini TTS error (status ${ttsRes.status}). Check server logs.` });
    }

    const data = await ttsRes.json();
    const part = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0];
    const base64Audio = part && part.inlineData && part.inlineData.data;

    if (!base64Audio) {
      return res.status(502).json({ error: "Gemini didn't return audio data. Try again, or shorten the lesson text." });
    }

    const pcmBuffer = Buffer.from(base64Audio, "base64");
    const wavBuffer = wrapPcmAsWav(pcmBuffer);

    res.set("Content-Type", "audio/wav");
    res.set("Content-Disposition", 'inline; filename="lesson-podcast.wav"');
    res.send(wavBuffer);
  } catch (err) {
    console.error("Podcast generation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// LESSON PLANS — structured lesson plans the rep can pick parts from to
// save into their personal Learning Roadmap.
// ---------------------------------------------------------------------
const LESSON_PLAN_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "A short, specific title for this learning path." },
    parts: {
      type: "array",
      description: "3 to 6 self-contained lessons in logical order. Each lesson has reading content AND a 3-question quiz. The quiz must be passed to unlock the next lesson.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title for this lesson." },
          summary: { type: "string", description: "One sentence only — a plain preview of what this lesson covers." },
          content: { type: "string", description: "The full, detailed learning module. 4-6 substantial paragraphs with concrete examples, specific phrases a rep could say, real-world scenarios. Wrap key terms in **double asterisks** like **Total Cost of Ownership**. Do NOT summarize." },
          quiz: {
            type: "array",
            description: "Exactly 3 multiple choice questions that test comprehension of THIS lesson's content only.",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                options: { type: "array", items: { type: "string" }, description: "Exactly 4 options." },
                correctIndex: { type: "integer", description: "Index 0-3 of the correct option." },
              },
              required: ["question", "options", "correctIndex"],
            },
          },
        },
        required: ["title", "summary", "content", "quiz"],
      },
    },
  },
  required: ["title", "parts"],
};

app.post("/api/lesson-plan", requireSession, async (req, res) => {
  const { topic } = req.body || {};
  if (!topic || !topic.trim()) return res.status(400).json({ error: "Missing a topic for the lesson plan." });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  try {
    const storeName = await getOrCreateFileSearchStore();

    // ---- Step 1: ground in the knowledge store, get plain text back. ----
    // Gemini does not currently allow combining `tools` (File Search)
    // with `responseSchema`/JSON mode in a single call — confirmed:
    // "Function calling with a response mime type: 'application/json'
    // is unsupported." So grounding and structuring have to be two
    // separate model calls.
    const draftPrompt = `Create a structured learning path on this topic: "${topic.trim()}". Write 3-6 lessons in logical order — each lesson should build on the previous one. For each lesson, write a full, detailed learning module (4-6 substantial paragraphs with concrete examples, specific phrases a rep could say, real objection scenarios). Wrap key terms in **double asterisks**. After each lesson's content, write exactly 3 multiple choice quiz questions (with 4 options each) that test comprehension of THAT lesson specifically. The quiz gates progression — reps must pass it to move to the next lesson. Ground any company-specific facts only in the connected knowledge store — if nothing relevant is found, keep that section as general sales technique.`;

    const draftRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: draftPrompt }] }],
          tools: [{ fileSearch: { fileSearchStoreNames: [storeName] } }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 16384 },
        }),
      }
    );

    if (!draftRes.ok) {
      const errText = await draftRes.text();
      console.error("Lesson plan draft error:", draftRes.status, errText);
      return res.status(502).json({ error: `Gemini error (status ${draftRes.status}). Check server logs.` });
    }

    const draftData = await draftRes.json();
    // Log the finish reason to help diagnose future failures
    const finishReason = draftData.candidates && draftData.candidates[0] && draftData.candidates[0].finishReason;
    if (finishReason && finishReason !== "STOP") {
      console.error("Lesson plan draft stopped early. finishReason:", finishReason, JSON.stringify(draftData).slice(0, 500));
    }
    const draftText = draftData.candidates && draftData.candidates[0] && draftData.candidates[0].content && draftData.candidates[0].content.parts && draftData.candidates[0].content.parts.map(p => p.text).join("");
    if (!draftText) return res.status(502).json({ error: "Gemini didn't return a lesson plan. Try rephrasing the topic." });

    // ---- Step 2: reformat that grounded text into strict JSON. ----
    // No `tools` here, so responseSchema is allowed in this call.
    const structurePrompt = `Reformat the following learning path content into the required JSON structure. Split it into a title and 3-6 sequential lessons. Rules: (1) "summary" = one plain sentence, no detail. (2) "content" = the full teaching text, preserved completely — do not summarize or shorten. Preserve all **double asterisk** markers. (3) "quiz" = exactly 3 multiple choice questions from after each lesson's content, each with 4 options and the correct index (0-3). The quiz questions should be drawn from the quiz questions written after each lesson in the source content below.\n\n${draftText}`;

    const structureRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: structurePrompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: LESSON_PLAN_SCHEMA,
            temperature: 0.2,
            maxOutputTokens: 16384,
          },
        }),
      }
    );

    if (!structureRes.ok) {
      const errText = await structureRes.text();
      console.error("Lesson plan structuring error:", structureRes.status, errText);
      return res.status(502).json({ error: `Gemini error formatting the lesson plan (status ${structureRes.status}). Check server logs.` });
    }

    const structureData = await structureRes.json();
    const rawJson = structureData.candidates && structureData.candidates[0] && structureData.candidates[0].content && structureData.candidates[0].content.parts && structureData.candidates[0].content.parts.map(p => p.text).join("");
    if (!rawJson) return res.status(502).json({ error: "Gemini didn't return a structured lesson plan. Try again." });

    let plan;
    try {
      plan = JSON.parse(rawJson);
    } catch (e) {
      console.error("Could not parse lesson plan JSON:", rawJson);
      return res.status(502).json({ error: "Got an unreadable lesson plan back. Try again." });
    }

    let saved = null;
    if (db.pool) {
      saved = await db.saveLessonPlan(req.userEmail, plan.title, topic.trim(), plan.parts);
    }

    res.json({ id: saved ? saved.id : null, title: plan.title, parts: plan.parts });
  } catch (err) {
    console.error("Lesson plan generation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// TEST — generate a quiz (multiple choice or open response) and score
// answers. Same two-step grounded-then-structured pattern as lesson
// plans and Generate, for the same reason (tools + responseSchema
// can't combine in one call).
// =====================================================================

const MCQ_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    questions: {
      type: "array",
      description: "5 scenario-based multiple choice questions.",
      items: {
        type: "object",
        properties: {
          question: { type: "string", description: "A scenario-based question, e.g. describing what a prospect said." },
          options: { type: "array", items: { type: "string" }, description: "Exactly 4 answer options." },
          correctIndex: { type: "integer", description: "Index (0-3) of the correct option." },
          explanation: { type: "string", description: "One sentence on why the correct answer is right." },
        },
        required: ["question", "options", "correctIndex", "explanation"],
      },
    },
  },
  required: ["title", "questions"],
};

const OPEN_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    questions: {
      type: "array",
      description: "5 scenario-based open-response questions.",
      items: {
        type: "object",
        properties: {
          question: { type: "string", description: "A scenario-based question requiring a written answer, not a single fact." },
          idealAnswerNotes: { type: "string", description: "What a strong answer should cover — used for scoring later, never shown to the test-taker up front." },
        },
        required: ["question", "idealAnswerNotes"],
      },
    },
  },
  required: ["title", "questions"],
};

app.post("/api/test/generate", requireSession, async (req, res) => {
  // groundedDraft/structureToJson are defined further down in this file
  // (in the Generate section) but are plain `function` declarations,
  // which JavaScript hoists — they're callable here regardless of
  // textual order. Kept in one place rather than duplicated.
  const { topic, format } = req.body || {};
  if (!topic || !topic.trim()) return res.status(400).json({ error: "Missing a topic for the test." });
  if (format !== "mcq" && format !== "open") return res.status(400).json({ error: "Format must be 'mcq' or 'open'." });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  try {
    const storeName = await getOrCreateFileSearchStore();
    const draftPrompt = `Create 5 scenario-based sales test questions on this topic: "${topic.trim()}". Each question should describe a realistic situation (e.g. what a prospect said or did) and ask what the rep should do or say next — not simple fact recall. Ground any company-specific facts only in the connected knowledge store — if nothing relevant is found there, keep the questions general sales technique instead of inventing company facts.`;
    const draftText = await groundedDraft(draftPrompt, storeName);

    const schema = format === "mcq" ? MCQ_SCHEMA : OPEN_RESPONSE_SCHEMA;
    const structurePrompt = format === "mcq"
      ? `Turn the following test content into 5 multiple choice questions, each with exactly 4 options, the correct option's index, and a one-sentence explanation.\n\n${draftText}`
      : `Turn the following test content into 5 open-response questions. For each, also write brief notes on what a strong answer should cover (idealAnswerNotes) — these notes are for scoring later and should never be shown to the test-taker.\n\n${draftText}`;
    const quiz = await structureToJson(structurePrompt, schema);

    res.json({ title: quiz.title, format, questions: quiz.questions });
  } catch (err) {
    console.error("Test generation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/test/score-open", requireSession, async (req, res) => {
  const { question, idealAnswerNotes, answer } = req.body || {};
  if (!question || !answer) return res.status(400).json({ error: "Missing question or answer." });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  const SCORE_SCHEMA = {
    type: "object",
    properties: {
      score: { type: "integer", description: "Score out of 5." },
      feedback: { type: "string", description: "One or two sentences of specific, constructive feedback." },
    },
    required: ["score", "feedback"],
  };

  try {
    const prompt = `You are grading a sales rep's answer to a scenario question. Score it from 0-5 based on how well it covers what a strong answer should include, and give brief, specific, constructive feedback (not generic praise).\n\nQuestion: ${question}\n\nWhat a strong answer should cover: ${idealAnswerNotes || "(use your own judgment)"}\n\nThe rep's answer: ${answer}`;
    const result = await structureToJson(prompt, SCORE_SCHEMA);
    res.json(result);
  } catch (err) {
    console.error("Open-response scoring error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// ROADMAP — saving chosen lesson-plan parts, and viewing/updating them.
// ---------------------------------------------------------------------
app.post("/api/roadmap/save", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet — see README Part 7." });
  const { lessonPlanId, items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Choose at least one part to save." });
  }
  try {
    const saved = await db.addRoadmapItems(req.userEmail, lessonPlanId || null, items, null);
    res.json({ ok: true, saved });
  } catch (err) {
    console.error("Roadmap save error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/roadmap", requireSession, async (req, res) => {
  if (!db.pool) return res.json({ items: [] });
  try {
    const items = await db.listRoadmapItems(req.userEmail, req.query.sortBy);
    res.json({ items });
  } catch (err) {
    console.error("Roadmap list error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/roadmap/overdue", requireSession, async (req, res) => {
  if (!db.pool) return res.json({ items: [] });
  try {
    const items = await db.listOverdueRoadmapItems(req.userEmail);
    res.json({ items });
  } catch (err) {
    console.error("Overdue roadmap list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/roadmap/:id/due-date", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet." });
  const { dueDate } = req.body || {};
  try {
    const updated = await db.updateRoadmapItemDueDate(parseInt(req.params.id, 10), req.userEmail, dueDate);
    if (!updated) return res.status(404).json({ error: "Roadmap item not found." });
    res.json({ ok: true, item: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/analytics", requireSession, async (req, res) => {
  if (!db.pool) {
    return res.json({ counts: { not_started: 0, in_progress: 0, done: 0, overdue: 0 } });
  }
  try {
    const counts = await db.countRoadmapItemsByStatus(req.userEmail);
    res.json({ counts });
  } catch (err) {
    console.error("Analytics error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/roadmap/:id/status", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet." });
  const { status } = req.body || {};
  try {
    const updated = await db.updateRoadmapItemStatus(parseInt(req.params.id, 10), req.userEmail, status);
    if (!updated) return res.status(404).json({ error: "Roadmap item not found." });
    res.json({ ok: true, item: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// DEALS — replaces the old in-memory, session-only deal list.
// ---------------------------------------------------------------------
app.get("/api/deals", requireSession, async (req, res) => {
  if (!db.pool) return res.json({ deals: [] });
  try {
    const deals = await db.listDeals(req.userEmail);
    res.json({ deals });
  } catch (err) {
    console.error("Deals list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// Deal extraction from an uploaded document — reads a note, email,
// meeting summary, or brief and pulls out structured deal fields for
// the rep to review/edit before saving (never auto-saves unreviewed
// extraction directly into a real record).
//
// PDFs and plain text go to Gemini natively (confirmed-working
// multimodal input). .docx is NOT reliable as direct multimodal input
// to generateContent — confirmed via real bug reports (400 "Unsupported
// MIME type" for .docx sent as inline_data) even though it's listed as
// supported for the separate File Search feature. So .docx is
// pre-converted to plain text with mammoth, then sent as text either
// way — same code path, no separate handling needed downstream.
// ---------------------------------------------------------------------
const DEAL_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Deal or account name. Required — make a reasonable short name from context if not explicitly stated." },
    company: { type: "string", description: "Company name, if mentioned." },
    dealOwner: { type: "string", description: "Who is running this deal, if mentioned." },
    peopleInvolved: { type: "array", items: { type: "string" }, description: "Names of people involved, if mentioned." },
    value: { type: "number", description: "Deal value in dollars, if mentioned. 0 if not stated." },
    timelineDate: { type: "string", description: "Target close date in YYYY-MM-DD format, if a date is mentioned or can be inferred. Empty string if not stated." },
    priority: { type: "string", enum: ["low", "medium", "high"], description: "Best guess at priority based on tone/urgency in the document. Default to medium if unclear." },
    notes: { type: "string", description: "A concise summary of other relevant context from the document — history, concerns, next steps. Do not just repeat the document verbatim." },
  },
  required: ["name", "notes"],
};

app.post("/api/deals/extract", requireSession, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const mimeType = req.file.mimetype || "";
    const isDocx = mimeType.includes("officedocument.wordprocessingml") || /\.docx$/i.test(req.file.originalname);
    const isPdf = mimeType === "application/pdf" || /\.pdf$/i.test(req.file.originalname);

    let contentsParts;
    if (isDocx) {
      // .docx isn't reliable as direct multimodal input to generateContent
      // (confirmed: real "Unsupported MIME type" errors) — extract to
      // plain text first, then send as text like any note.
      const { value: text } = await mammoth.extractRawText({ buffer: fileBuffer });
      if (!text || !text.trim()) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Couldn't find any readable text in that document." });
      }
      contentsParts = [{ text: `Extract deal details from this document:\n\n${text}` }];
    } else if (isPdf) {
      contentsParts = [
        { text: "Extract deal details from this document." },
        { inlineData: { mimeType: "application/pdf", data: fileBuffer.toString("base64") } },
      ];
    } else {
      // Plain text and similar — read directly as text.
      const text = fileBuffer.toString("utf8");
      if (!text || !text.trim()) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Couldn't find any readable text in that file." });
      }
      contentsParts = [{ text: `Extract deal details from this note:\n\n${text}` }];
    }

    fs.unlinkSync(req.file.path);

    const extractionPrompt = `You are extracting structured CRM deal fields from an uploaded document for a sales rep. Only use facts actually present in the document — if a field isn't mentioned, leave it blank/zero/empty rather than guessing or inventing a plausible-sounding value. The rep will review and edit every field before saving, so it's fine to leave things blank.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: contentsParts }],
          systemInstruction: { parts: [{ text: extractionPrompt }] },
          generationConfig: { responseMimeType: "application/json", responseSchema: DEAL_EXTRACTION_SCHEMA, temperature: 0.1 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Deal extraction error:", geminiRes.status, errText);
      return res.status(502).json({ error: `Gemini error (status ${geminiRes.status}). Check server logs.` });
    }

    const data = await geminiRes.json();
    const rawJson = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.map(p => p.text).join("");
    if (!rawJson) return res.status(502).json({ error: "Gemini didn't return anything usable. Try a different file." });

    let extracted;
    try {
      extracted = JSON.parse(rawJson);
    } catch (e) {
      console.error("Could not parse deal extraction JSON:", rawJson);
      return res.status(502).json({ error: "Got an unreadable response back. Try again." });
    }

    res.json(extracted);
  } catch (err) {
    console.error("Deal extraction error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/deals", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet — see README Part 3." });
  const { name, company, dealOwner, peopleInvolved, value, timelineDate, priority, status, notes } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "A deal needs a name." });
  try {
    const deal = await db.createDeal(req.userEmail, {
      name: name.trim(),
      company: company || null,
      dealOwner: dealOwner || null,
      peopleInvolved: peopleInvolved || [],
      value: value || 0,
      timelineDate: timelineDate || null,
      priority: priority || "medium",
      status: status || "open",
      notes: notes || null,
    });
    res.json({ ok: true, deal });
  } catch (err) {
    console.error("Create deal error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/deals/:id", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet." });
  try {
    const updated = await db.updateDeal(parseInt(req.params.id, 10), req.userEmail, req.body || {});
    if (!updated) return res.status(404).json({ error: "Deal not found." });
    res.json({ ok: true, deal: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/deals/:id", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet." });
  try {
    await db.deleteDeal(parseInt(req.params.id, 10), req.userEmail);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deal documents — uploaded files attached to a specific deal. Reuses
// the same Gemini File Search store as the Knowledge screen, so these
// documents are also searchable by the AI when a conversation is
// anchored to this deal (see buildDealContextPrefix in the chat route).
app.post("/api/deals/:id/documents", requireSession, upload.single("file"), async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet." });
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  const dealId = parseInt(req.params.id, 10);
  try {
    const deal = await db.getDeal(dealId, req.userEmail);
    if (!deal) return res.status(404).json({ error: "Deal not found." });

    const storeName = await getOrCreateFileSearchStore();
    const fileBuffer = fs.readFileSync(req.file.path);

    const uploadRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/${storeName}:uploadToFileSearchStore`,
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
      throw new Error(`Upload to File Search store failed: ${uploadRes.status} ${text}`);
    }
    let operation = await uploadRes.json();

    const maxAttempts = 30;
    let attempts = 0;
    while (!operation.done && attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${operation.name}`,
        { headers: { "x-goog-api-key": GEMINI_API_KEY } }
      );
      if (!pollRes.ok) {
        const text = await pollRes.text();
        throw new Error(`Checking upload status failed: ${pollRes.status} ${text}`);
      }
      operation = await pollRes.json();
      attempts++;
    }
    if (operation.error) {
      throw new Error(`Indexing failed: ${operation.error.message || JSON.stringify(operation.error)}`);
    }

    fs.unlinkSync(req.file.path);
    const saved = await db.addDealDocument(dealId, req.userEmail, req.file.originalname, null);
    res.json({ ok: true, document: saved, note: operation.done ? null : "Still indexing in the background." });
  } catch (err) {
    console.error("Deal document upload error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/deals/:id/documents", requireSession, async (req, res) => {
  if (!db.pool) return res.json({ documents: [] });
  try {
    const documents = await db.listDealDocuments(parseInt(req.params.id, 10), req.userEmail);
    res.json({ documents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// HISTORY — replaces the old in-memory, session-only history list.
// ---------------------------------------------------------------------
app.get("/api/history", requireSession, async (req, res) => {
  if (!db.pool) return res.json({ items: [] });
  try {
    const items = await db.listHistory(req.userEmail);
    res.json({ items });
  } catch (err) {
    console.error("History list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// MANAGER — viewing/managing reports, and assigning roadmap items.
// ---------------------------------------------------------------------
app.get("/api/manager/team", requireSession, requireManager, async (req, res) => {
  try {
    const reports = await db.listReportsOf(req.userEmail);
    res.json({ reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/manager/all-users", requireSession, requireManager, async (req, res) => {
  try {
    const users = await db.listAllUsers();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/manager/set-role", requireSession, requireManager, async (req, res) => {
  const { email, role } = req.body || {};
  if (!email || !role) return res.status(400).json({ error: "Missing email or role." });
  try {
    await db.setUserRole(email, role);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/manager/assign-report", requireSession, requireManager, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Missing email." });
  try {
    const user = await db.getUser(email);
    if (!user) return res.status(404).json({ error: "That person hasn't signed in yet, so there's no account to assign." });
    await db.setUserManager(email, req.userEmail);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/manager/assign-lesson", requireSession, requireManager, async (req, res) => {
  const { reportEmail, lessonPlanId, items } = req.body || {};
  if (!reportEmail || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Missing reportEmail or items to assign." });
  }
  try {
    const reports = await db.listReportsOf(req.userEmail);
    const isMyReport = reports.some(r => r.email === reportEmail);
    if (!isMyReport) return res.status(403).json({ error: "You can only assign lessons to your own reports." });

    const saved = await db.addRoadmapItems(reportEmail, lessonPlanId || null, items, req.userEmail);
    res.json({ ok: true, saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// GENERATE — PPTX and DOCX (proposal) generation.
//
// Same two-step pattern used for lesson plans: ground in File Search
// with a plain-text call first (tools), then reformat into strict JSON
// with a second call (responseSchema) — Gemini does not currently
// support combining `tools` with `responseMimeType: "application/json"`
// in one request (confirmed: "Function calling with a response mime
// type: 'application/json' is unsupported").
// =====================================================================

function buildDealBriefText(dealContext) {
  if (!dealContext) return "";
  const facts = [];
  facts.push(`Deal: ${dealContext.name}`);
  if (dealContext.company) facts.push(`Company: ${dealContext.company}`);
  if (dealContext.value) facts.push(`Value: $${Number(dealContext.value).toLocaleString()}`);
  if (dealContext.timeline_date) facts.push(`Target close date: ${dealContext.timeline_date}`);
  if (Array.isArray(dealContext.people_involved) && dealContext.people_involved.length) {
    facts.push(`People involved: ${dealContext.people_involved.join(", ")}`);
  }
  if (dealContext.notes) facts.push(`Notes: ${dealContext.notes}`);
  return facts.length ? `\n\nUse this deal context where relevant: ${facts.join(". ")}.` : "";
}

async function groundedDraft(prompt, storeName) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ fileSearch: { fileSearchStoreNames: [storeName] } }],
        generationConfig: { temperature: 0.7 },
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini draft error (status ${res.status}): ${errText}`);
  }
  const data = await res.json();
  const text = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.map(p => p.text).join("");
  if (!text) throw new Error("Gemini didn't return any draft content.");

  // Generation routes (lesson plans, tests, decks, proposals) are
  // instructed to "keep it general" rather than refuse outright when
  // Knowledge docs come up thin — useful, but the public Pure
  // Storage / Everpure website is real company-specific material that
  // shouldn't go unused just because it isn't in Knowledge. Same
  // two-call constraint as the chat route (File Search and urlContext
  // cannot combine in one request), so this fills gaps as a second
  // pass over the same draft rather than a single bigger call.
  try {
    const fillPrompt = `${COMPANY_WEBSITE_URLS.join(" and ")}\n\nHere is a draft that was grounded in internal company documents:\n\n${text}\n\nUsing the public website above, fill in any sections that were kept general due to missing internal documentation, with real company-specific facts where the site covers them. Keep everything else from the draft unchanged. If the website doesn't cover a gap either, leave that section as-is.`;
    const fillRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fillPrompt }] }],
          tools: [{ urlContext: {} }],
          generationConfig: { temperature: 0.5 },
        }),
      }
    );
    if (fillRes.ok) {
      const fillData = await fillRes.json();
      const filledText = fillData.candidates && fillData.candidates[0] && fillData.candidates[0].content && fillData.candidates[0].content.parts && fillData.candidates[0].content.parts.map(p => p.text).join("");
      if (filledText) return filledText;
    }
  } catch (fillErr) {
    console.error("Website fill-in pass failed, using Knowledge-only draft:", fillErr.message);
  }

  return text;
}

async function structureToJson(prompt, schema) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 },
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini structuring error (status ${res.status}): ${errText}`);
  }
  const data = await res.json();
  const rawJson = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.map(p => p.text).join("");
  if (!rawJson) throw new Error("Gemini didn't return structured content.");
  return JSON.parse(rawJson);
}

const SLIDE_DECK_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Presentation title." },
    slides: {
      type: "array",
      description: "5 to 10 slides.",
      items: {
        type: "object",
        properties: {
          heading: { type: "string", description: "Slide heading, short." },
          bullets: { type: "array", items: { type: "string" }, description: "3-5 concise bullet points for this slide." },
        },
        required: ["heading", "bullets"],
      },
    },
  },
  required: ["title", "slides"],
};

// ---------------------------------------------------------------------
// PPTX theming — brand palette, decorative shapes, and layout variants.
// Palette values are kept in sync by hand with public/styles.css's CSS
// variables, since this runs server-side and can't read a stylesheet.
// Verified by actually rendering sample decks (incl. a long-title edge
// case that initially collided with the subtitle, now fixed by sizing
// the title dynamically) rather than just checked for valid syntax.
// ---------------------------------------------------------------------
const PPTX_BRAND = {
  charcoal: "2D2A27",
  cream: "FFF4DD",
  paper: "FFF5E3",
  peach: "FFCFB6",
  terracotta: "D55D1D",
  terracottaDeep: "A8480F",
  bright: "FF7023",
  sage: "5A6359",
  sageBg: "CFE8D4",
  white: "FFFFFF",
};

function addHexCluster(slide, opts) {
  const { x, y, size = 1.1, color = PPTX_BRAND.peach, opacity = 35, count = 3 } = opts;
  const positions = [
    { dx: 0, dy: 0 },
    { dx: size * 0.85, dy: size * 0.5 },
    { dx: 0, dy: size * 1.0 },
  ].slice(0, count);
  positions.forEach(p => {
    slide.addShape("hexagon", {
      x: x + p.dx, y: y + p.dy, w: size, h: size,
      fill: { color, transparency: 100 - opacity },
      line: { type: "none" },
    });
  });
}

function addCornerAccent(slide, corner) {
  if (corner === "topRight") {
    addHexCluster(slide, { x: 8.6, y: -0.3, size: 1.0, color: PPTX_BRAND.peach, opacity: 50 });
    slide.addShape("hexagon", { x: 9.3, y: 0.5, w: 0.6, h: 0.6, fill: { color: PPTX_BRAND.terracotta, transparency: 80 }, line: { type: "none" } });
  } else {
    addHexCluster(slide, { x: -0.4, y: 4.6, size: 1.0, color: PPTX_BRAND.peach, opacity: 45 });
    slide.addShape("hexagon", { x: 0.3, y: 4.3, w: 0.55, h: 0.55, fill: { color: PPTX_BRAND.sage, transparency: 82 }, line: { type: "none" } });
  }
}

function buildThemedDeck(deck) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "EVERPURE_16x9", width: 10, height: 5.63 });
  pptx.layout = "EVERPURE_16x9";

  // ---------- Cover slide ----------
  const cover = pptx.addSlide();
  cover.background = { color: PPTX_BRAND.cream };
  addHexCluster(cover, { x: 7.6, y: 3.6, size: 1.3, color: PPTX_BRAND.peach, opacity: 55 });
  addHexCluster(cover, { x: -0.5, y: -0.5, size: 1.1, color: PPTX_BRAND.terracotta, opacity: 12 });
  cover.addShape("rect", { x: 0, y: 2.55, w: 0.14, h: 0.9, fill: { color: PPTX_BRAND.terracotta }, line: { type: "none" } });

  // Long titles wrap to more lines in a fixed-height box — shrink the
  // font and position the subtitle based on estimated line count
  // instead of a fixed Y, so long titles can't collide with it.
  const titleLen = (deck.title || "").length;
  const titleFontSize = titleLen > 60 ? 22 : titleLen > 40 ? 26 : 30;
  const estimatedLines = Math.max(1, Math.ceil(titleLen / (titleLen > 60 ? 34 : titleLen > 40 ? 30 : 26)));
  const titleBoxH = 0.55 * estimatedLines + 0.3;
  const titleY = 2.3;
  const subtitleY = titleY + titleBoxH + 0.15;

  cover.addText(deck.title, {
    x: 0.6, y: titleY, w: 8.8, h: titleBoxH,
    fontSize: titleFontSize, bold: true, color: PPTX_BRAND.charcoal, fontFace: "Arial", align: "left", valign: "top",
  });
  cover.addText("Sales Companion", {
    x: 0.6, y: subtitleY, w: 6, h: 0.5,
    fontSize: 14, color: PPTX_BRAND.terracottaDeep, bold: true, fontFace: "Arial",
  });

  // ---------- Content slides ----------
  // Alternate two layout treatments so the deck has rhythm instead of
  // one template repeated: 'standard' (top accent bar, heading + square
  // bullets, hex cluster top-right) and 'sidebar' (left color bar,
  // heading + diamond bullets, hex cluster bottom-left).
  deck.slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    const layoutVariant = i % 2 === 0 ? "standard" : "sidebar";
    slide.background = { color: PPTX_BRAND.paper };

    if (layoutVariant === "standard") {
      addCornerAccent(slide, "topRight");
      slide.addShape("rect", { x: 0, y: 0, w: 10, h: 0.12, fill: { color: PPTX_BRAND.terracotta }, line: { type: "none" } });
      slide.addText(s.heading, {
        x: 0.55, y: 0.45, w: 8.5, h: 0.7,
        fontSize: 22, bold: true, color: PPTX_BRAND.charcoal, fontFace: "Arial",
      });
      const bulletText = (s.bullets || []).map(b => ({
        text: b,
        options: { bullet: { code: "25A0", indent: 18 }, color: PPTX_BRAND.charcoal, breakLine: true },
      }));
      slide.addText(bulletText, {
        x: 0.65, y: 1.35, w: 8.3, h: 3.8, fontSize: 14.5, fontFace: "Arial", valign: "top",
        paraSpaceAfter: 10,
      });
    } else {
      addCornerAccent(slide, "bottomLeft");
      slide.addShape("rect", { x: 0, y: 0, w: 0.16, h: 5.63, fill: { color: PPTX_BRAND.sage }, line: { type: "none" } });
      slide.addText(s.heading, {
        x: 0.5, y: 0.45, w: 8.7, h: 0.7,
        fontSize: 22, bold: true, color: PPTX_BRAND.charcoal, fontFace: "Arial",
      });
      const bulletText = (s.bullets || []).map(b => ({
        text: b,
        options: { bullet: { code: "25C6", indent: 18 }, color: PPTX_BRAND.charcoal, breakLine: true },
      }));
      slide.addText(bulletText, {
        x: 0.6, y: 1.35, w: 8.4, h: 3.8, fontSize: 14.5, fontFace: "Arial", valign: "top",
        paraSpaceAfter: 10,
      });
    }

    slide.addText(String(i + 1), {
      x: 9.4, y: 5.2, w: 0.5, h: 0.35, fontSize: 10, color: PPTX_BRAND.terracottaDeep, align: "right", fontFace: "Arial",
    });
  });

  // ---------- Closing slide ----------
  const closing = pptx.addSlide();
  closing.background = { color: PPTX_BRAND.charcoal };
  addHexCluster(closing, { x: 7.8, y: -0.3, size: 1.1, color: PPTX_BRAND.terracotta, opacity: 40 });
  addHexCluster(closing, { x: -0.5, y: 4.3, size: 1.0, color: PPTX_BRAND.sage, opacity: 50 });
  closing.addText("Thank you", {
    x: 0.6, y: 2.4, w: 8.8, h: 1, fontSize: 26, bold: true, color: PPTX_BRAND.white, fontFace: "Arial",
  });
  closing.addText(deck.title, {
    x: 0.6, y: 3.15, w: 8.8, h: 0.6, fontSize: 13, color: PPTX_BRAND.peach, fontFace: "Arial",
  });

  return pptx;
}

app.post("/api/generate/pptx", requireSession, async (req, res) => {
  const { topic, dealContext, customTitle } = req.body || {};
  if (!topic || !topic.trim()) return res.status(400).json({ error: "Missing a topic for the presentation." });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  try {
    const storeName = await getOrCreateFileSearchStore();
    const dealBrief = buildDealBriefText(dealContext);

    const draftPrompt = `Create the content for a sales presentation on this topic: "${topic.trim()}". Write it as plain text with 5-10 clearly separated sections, each with a short heading and a handful of key points. Ground any company-specific facts only in the connected knowledge store — if nothing relevant is found there, keep that section general rather than inventing company facts.${dealBrief}`;
    const draftText = await groundedDraft(draftPrompt, storeName);

    const structurePrompt = `Reformat the following presentation content into the required JSON slide structure: a title and 5-10 slides, each with a heading and 3-5 short bullet points. Keep bullets concise — they're for a slide, not a paragraph.\n\n${draftText}`;
    const deck = await structureToJson(structurePrompt, SLIDE_DECK_SCHEMA);

    // A user-provided title always wins over whatever the model named it.
    if (customTitle && customTitle.trim()) deck.title = customTitle.trim();

    const pptx = buildThemedDeck(deck);
    const buffer = await pptx.write({ outputType: "nodebuffer" });
    const filename = `${deck.title.replace(/[^a-z0-9]+/gi, "_")}.pptx`;

    if (db.pool) {
      db.saveGeneratedContent(req.userEmail, deck.title, "pptx", filename, buffer, dealContext && dealContext.id ? dealContext.id : null)
        .catch(err => console.error("Could not save generated PPTX:", err.message));
    }

    res.set("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("PPTX generation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Proposal title." },
    sections: {
      type: "array",
      description: "4 to 8 sections, e.g. Executive Summary, Proposed Solution, Pricing, Timeline, Next Steps.",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          content: { type: "string", description: "Full paragraph(s) of proposal content for this section." },
        },
        required: ["heading", "content"],
      },
    },
  },
  required: ["title", "sections"],
};

app.post("/api/generate/docx", requireSession, async (req, res) => {
  const { topic, dealContext, customTitle } = req.body || {};
  if (!topic || !topic.trim()) return res.status(400).json({ error: "Missing a topic for the proposal." });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  try {
    const storeName = await getOrCreateFileSearchStore();
    const dealBrief = buildDealBriefText(dealContext);

    const draftPrompt = `Write a sales proposal document on this topic: "${topic.trim()}". Cover sections like Executive Summary, Proposed Solution, Pricing, Timeline, and Next Steps, as plain text with clear section headings. Ground any company-specific facts (pricing, product capabilities, etc.) only in the connected knowledge store — if nothing relevant is found there, write that section in general terms rather than inventing company facts.${dealBrief}`;
    const draftText = await groundedDraft(draftPrompt, storeName);

    const structurePrompt = `Reformat the following proposal content into the required JSON structure: a title and 4-8 sections, each with a heading and its full content preserved (do not summarize or shorten).\n\n${draftText}`;
    const proposal = await structureToJson(structurePrompt, PROPOSAL_SCHEMA);

    if (customTitle && customTitle.trim()) proposal.title = customTitle.trim();

    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
    const children = [
      new Paragraph({ text: proposal.title, heading: HeadingLevel.TITLE }),
    ];
    proposal.sections.forEach(s => {
      children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } }));
      s.content.split("\n").filter(p => p.trim()).forEach(para => {
        children.push(new Paragraph({ children: [new TextRun(para.trim())], spacing: { after: 150 } }));
      });
    });

    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);
    const filename = `${proposal.title.replace(/[^a-z0-9]+/gi, "_")}.docx`;

    if (db.pool) {
      db.saveGeneratedContent(req.userEmail, proposal.title, "docx", filename, buffer, dealContext && dealContext.id ? dealContext.id : null)
        .catch(err => console.error("Could not save generated DOCX:", err.message));
    }

    res.set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("DOCX generation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// Generated content library — list and re-download previously
// generated PPTX/DOCX files (the "Generated content" view on History).
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Lesson notes — free-text notes taken while reading a saved roadmap
// item, listed on their own Notes tab alongside the topic they're from.
// ---------------------------------------------------------------------
app.post("/api/notes", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet." });
  const { roadmapItemId, topic, noteText } = req.body || {};
  if (!topic || !noteText || !noteText.trim()) return res.status(400).json({ error: "Missing topic or note text." });
  try {
    const note = await db.addLessonNote(req.userEmail, roadmapItemId || null, topic, noteText.trim());
    res.json({ ok: true, note });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/notes", requireSession, async (req, res) => {
  if (!db.pool) return res.json({ notes: [] });
  try {
    const notes = await db.listLessonNotes(req.userEmail);
    res.json({ notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/notes/:id", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet." });
  try {
    await db.deleteLessonNote(parseInt(req.params.id, 10), req.userEmail);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// Mini per-lesson quiz — generates a short quiz grounded in one saved
// lesson's actual content (not a general topic, unlike standalone Test
// mode), to check the rep actually absorbed that specific lesson.
// ---------------------------------------------------------------------
const MINI_QUIZ_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      description: "Exactly 3 multiple choice questions testing understanding of the given lesson content.",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" }, description: "Exactly 4 options." },
          correctIndex: { type: "integer", description: "Index 0-3 of the correct option." },
        },
        required: ["question", "options", "correctIndex"],
      },
    },
  },
  required: ["questions"],
};

app.post("/api/lesson-quiz/generate", requireSession, async (req, res) => {
  const { lessonContent, lessonTitle } = req.body || {};
  if (!lessonContent || !lessonContent.trim()) return res.status(400).json({ error: "Missing lesson content to quiz on." });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  try {
    const prompt = `Based ONLY on the following lesson content (titled "${lessonTitle || "this lesson"}"), write exactly 3 multiple choice questions that check whether someone actually read and understood it. Questions should test comprehension of THIS content specifically, not general sales knowledge. Each question needs exactly 4 options and one correct index.\n\nLesson content:\n${lessonContent}`;
    const result = await structureToJson(prompt, MINI_QUIZ_SCHEMA);
    res.json(result);
  } catch (err) {
    console.error("Mini quiz generation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/lesson-quiz/submit", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet." });
  const { roadmapItemId, score, total, lessonPlanId } = req.body || {};
  if (roadmapItemId == null || score == null || total == null) return res.status(400).json({ error: "Missing roadmapItemId, score, or total." });
  try {
    const attempt = await db.addLessonQuizAttempt(req.userEmail, roadmapItemId, score, total);

    let badge = null;
    let certificate = null;

    // Award badge if passing score (at least 2/3 correct)
    if (score >= Math.ceil(total * 0.67)) {
      badge = await db.awardBadge(roadmapItemId, req.userEmail);
      // Also mark the roadmap item as done
      await db.updateRoadmapItemStatus(roadmapItemId, req.userEmail, "done");
      // Check if the entire learning path is now complete
      if (lessonPlanId) {
        certificate = await db.checkAndAwardCertificate(req.userEmail, lessonPlanId);
      }
    }

    res.json({ ok: true, attempt, badge, certificate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// Manager assignment visibility — every lesson a manager has assigned
// across their whole team, with each report's live completion status.
// ---------------------------------------------------------------------
app.get("/api/manager/assignments", requireSession, requireManager, async (req, res) => {
  try {
    const assignments = await db.listAssignmentsByManager(req.userEmail);
    res.json({ assignments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/generated-content", requireSession, async (req, res) => {
  if (!db.pool) return res.json({ items: [] });
  try {
    const items = await db.listGeneratedContent(req.userEmail);
    res.json({ items });
  } catch (err) {
    console.error("Generated content list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/generated-content/:id/download", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured." });
  try {
    const file = await db.getGeneratedContentFile(parseInt(req.params.id, 10), req.userEmail);
    if (!file) return res.status(404).json({ error: "File not found." });
    const contentType = file.file_type === "pptx"
      ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    res.set("Content-Type", contentType);
    res.set("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.file_data);
  } catch (err) {
    console.error("Generated content download error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// CALL ANALYSIS — rep pastes or uploads a call transcript, gets back
// a structured analysis: objections raised, how they were handled,
// score, and specific improvement suggestions.
// ---------------------------------------------------------------------
const CALL_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    overallScore: { type: "integer", description: "Score out of 10." },
    summary: { type: "string", description: "2-3 sentence overview of how the call went." },
    objections: {
      type: "array",
      description: "Each objection the prospect raised.",
      items: {
        type: "object",
        properties: {
          objection: { type: "string" },
          howHandled: { type: "string" },
          quality: { type: "string", enum: ["strong", "ok", "weak"] },
          betterResponse: { type: "string", description: "A stronger way to have responded." },
        },
        required: ["objection", "howHandled", "quality", "betterResponse"],
      },
    },
    strengths: { type: "array", items: { type: "string" }, description: "2-3 things the rep did well." },
    improvements: { type: "array", items: { type: "string" }, description: "2-3 specific things to improve." },
    topPracticeArea: { type: "string", description: "The single most important thing to practice before the next call." },
  },
  required: ["overallScore", "summary", "objections", "strengths", "improvements", "topPracticeArea"],
};

app.post("/api/call-analysis", requireSession, upload.single("file"), async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  try {
    let transcriptText = req.body && req.body.transcript ? req.body.transcript.trim() : "";

    if (req.file) {
      const fileBuffer = fs.readFileSync(req.file.path);
      const mimeType = req.file.mimetype || "";
      const isDocx = mimeType.includes("officedocument.wordprocessingml") || /\.docx$/i.test(req.file.originalname);
      if (isDocx) {
        const { value } = await mammoth.extractRawText({ buffer: fileBuffer });
        transcriptText = value || "";
      } else {
        transcriptText = fileBuffer.toString("utf8");
      }
      fs.unlinkSync(req.file.path);
    }

    if (!transcriptText) return res.status(400).json({ error: "Paste a transcript or upload a file." });

    const prompt = `You are a sales coach analyzing a call transcript. Score the rep's performance, identify every objection the prospect raised and how well the rep handled it, list 2-3 strengths, 2-3 specific improvements, and name the single most important practice area for next time. Be direct and specific — this is coaching, not encouragement.\n\nTranscript:\n${transcriptText.slice(0, 8000)}`;

    const result = await structureToJson(prompt, CALL_ANALYSIS_SCHEMA);
    res.json(result);
  } catch (err) {
    console.error("Call analysis error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// CERTIFICATES & QUIZ LOG — for the Analytics tab on the roadmap
// ---------------------------------------------------------------------
app.get("/api/certificates", requireSession, async (req, res) => {
  if (!db.pool) return res.json({ certificates: [] });
  try {
    const certificates = await db.getCertificates(req.userEmail);
    res.json({ certificates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/quiz-log", requireSession, async (req, res) => {
  if (!db.pool) return res.json({ attempts: [] });
  try {
    const attempts = await db.listAllQuizAttempts(req.userEmail);
    res.json({ attempts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// knowledge base plus the public website.
// ---------------------------------------------------------------------
const BATTLECARD_SCHEMA = {
  type: "object",
  properties: {
    competitor: { type: "string" },
    theirStrengths: { type: "array", items: { type: "string" }, description: "2-4 genuine strengths of the competitor." },
    ourAdvantages: { type: "array", items: { type: "string" }, description: "2-4 real advantages we have over them." },
    trapQuestions: { type: "array", items: { type: "string" }, description: "3-5 discovery questions that expose their weaknesses." },
    objectionHandlers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          objection: { type: "string", description: "e.g. 'They're cheaper'" },
          response: { type: "string", description: "A concise, confident response." },
        },
        required: ["objection", "response"],
      },
    },
    oneLiner: { type: "string", description: "One sentence that captures our competitive position vs this competitor." },
  },
  required: ["competitor", "theirStrengths", "ourAdvantages", "trapQuestions", "objectionHandlers", "oneLiner"],
};

app.post("/api/battlecard", requireSession, async (req, res) => {
  const { competitor } = req.body || {};
  if (!competitor || !competitor.trim()) return res.status(400).json({ error: "Missing competitor name." });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  try {
    const storeName = await getOrCreateFileSearchStore();
    const draftPrompt = `Create a competitor battlecard for a sales rep going up against ${competitor.trim()}. Include their genuine strengths (be honest — reps need to know what they're up against), our advantages over them, trap discovery questions that expose their weaknesses, objection handlers for the most common "why not go with ${competitor.trim()}" pushbacks, and a one-liner positioning statement. Ground everything in the knowledge base and public website — do not invent product details.`;
    const draftText = await groundedDraft(draftPrompt, storeName);
    const structurePrompt = `Reformat the following battlecard content into the required JSON structure. Preserve all specific details — do not summarize.\n\n${draftText}`;
    const card = await structureToJson(structurePrompt, BATTLECARD_SCHEMA);
    res.json(card);
  } catch (err) {
    console.error("Battlecard error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// DEAL RISK SCORING — analyzes a deal's fields and flags risks.
// ---------------------------------------------------------------------
const DEAL_RISK_SCHEMA = {
  type: "object",
  properties: {
    riskLevel: { type: "string", enum: ["low", "medium", "high"] },
    score: { type: "integer", description: "Risk score 0-100. Higher = more at risk." },
    flags: { type: "array", items: { type: "string" }, description: "Specific risk signals detected." },
    actions: { type: "array", items: { type: "string" }, description: "2-4 concrete next actions to reduce risk." },
  },
  required: ["riskLevel", "score", "flags", "actions"],
};

app.get("/api/deals/:id/risk", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet." });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  try {
    const deal = await db.getDeal(parseInt(req.params.id, 10), req.userEmail);
    if (!deal) return res.status(404).json({ error: "Deal not found." });

    const daysSinceUpdate = Math.floor((Date.now() - new Date(deal.updated_at).getTime()) / (1000 * 60 * 60 * 24));
    const daysUntilClose = deal.timeline_date
      ? Math.floor((new Date(deal.timeline_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null;

    const dealSummary = [
      `Deal name: ${deal.name}`,
      `Company: ${deal.company || "not specified"}`,
      `Value: ${deal.value ? "$" + Number(deal.value).toLocaleString() : "not specified"}`,
      `Priority: ${deal.priority}`,
      `Status: ${deal.status}`,
      `People involved: ${Array.isArray(deal.people_involved) && deal.people_involved.length ? deal.people_involved.join(", ") : "none listed"}`,
      `Timeline: ${deal.timeline_date ? `closes ${deal.timeline_date} (${daysUntilClose} days away)` : "no close date set"}`,
      `Last updated: ${daysSinceUpdate} days ago`,
      `Notes: ${deal.notes || "none"}`,
    ].join("\n");

    const prompt = `You are a sales manager reviewing a deal for risk. Assess the likelihood this deal will slip, be lost, or stall based on the deal details below. Flag any specific risk signals (e.g. no close date, no champion identified, past due, high value with low activity, no notes). Suggest concrete next actions.\n\nDeal details:\n${dealSummary}`;
    const result = await structureToJson(prompt, DEAL_RISK_SCHEMA);
    res.json(result);
  } catch (err) {
    console.error("Deal risk error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// SUGGESTED NEXT LESSONS — after completing a lesson, suggest 3 related
// topics worth studying next.
// ---------------------------------------------------------------------
app.post("/api/roadmap/suggestions", requireSession, async (req, res) => {
  const { completedTopic } = req.body || {};
  if (!completedTopic) return res.status(400).json({ error: "Missing completedTopic." });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });

  const SUGGESTIONS_SCHEMA = {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string", description: "A short lesson topic title (5-8 words max)." },
            reason: { type: "string", description: "One sentence on why this is a natural next step." },
          },
          required: ["topic", "reason"],
        },
      },
    },
    required: ["suggestions"],
  };

  try {
    const prompt = `A sales rep just completed a lesson on: "${completedTopic}". Suggest exactly 3 related topics they should study next to build on what they learned. Each suggestion should be a specific, actionable lesson topic (not generic like "sales skills") and a one-sentence reason why it logically follows from what they just covered. Think about what gaps or natural next steps emerge from this topic.`;
    const result = await structureToJson(prompt, SUGGESTIONS_SCHEMA);
    res.json(result);
  } catch (err) {
    console.error("Suggestions error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// SAVED SEARCHES
// ---------------------------------------------------------------------
app.get("/api/saved-searches", requireSession, async (req, res) => {
  if (!db.pool) return res.json({ searches: [] });
  try {
    const searches = await db.listSavedSearches(req.userEmail);
    res.json({ searches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/saved-searches", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet." });
  const { name, query, tagFilter } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Give this search a name." });
  try {
    const search = await db.createSavedSearch(req.userEmail, name.trim(), query || "", tagFilter || "All");
    res.json({ ok: true, search });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/saved-searches/:id", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet." });
  try {
    await db.deleteSavedSearch(parseInt(req.params.id, 10), req.userEmail);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// BADGES
// ---------------------------------------------------------------------
app.get("/api/badges", requireSession, async (req, res) => {
  if (!db.pool) return res.json({ badges: [] });
  try {
    const badges = await db.getBadges(req.userEmail);
    res.json({ badges });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/badges/award", requireSession, async (req, res) => {
  if (!db.pool) return res.status(500).json({ error: "Database is not configured yet." });
  const { roadmapItemId } = req.body || {};
  if (!roadmapItemId) return res.status(400).json({ error: "Missing roadmapItemId." });
  try {
    const badge = await db.awardBadge(roadmapItemId, req.userEmail);
    res.json({ ok: true, badge });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// ONBOARDING TRACKS
// ---------------------------------------------------------------------
app.get("/api/manager/tracks", requireSession, requireManager, async (req, res) => {
  try {
    const tracks = await db.listOnboardingTracks(req.userEmail);
    res.json({ tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/manager/tracks", requireSession, requireManager, async (req, res) => {
  const { name, description, topics } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Track needs a name." });
  if (!Array.isArray(topics) || topics.length === 0) return res.status(400).json({ error: "Add at least one topic." });
  try {
    const track = await db.createOnboardingTrack(req.userEmail, name.trim(), description || null, topics);
    res.json({ ok: true, track });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/manager/tracks/:id/assign", requireSession, requireManager, async (req, res) => {
  const { assigneeEmail } = req.body || {};
  if (!assigneeEmail) return res.status(400).json({ error: "Missing assigneeEmail." });
  try {
    await db.assignOnboardingTrack(parseInt(req.params.id, 10), assigneeEmail, req.userEmail);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/manager/tracks/:id/progress", requireSession, requireManager, async (req, res) => {
  const { assigneeEmail } = req.query;
  if (!assigneeEmail) return res.status(400).json({ error: "Missing assigneeEmail." });
  try {
    const progress = await db.getOnboardingTrackProgress(parseInt(req.params.id, 10), assigneeEmail);
    res.json({ progress });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, async () => {
  try {
    await db.ensureSchema();
  } catch (err) {
    console.error("Could not set up database schema:", err.message);
    console.error("Roadmap, lesson plans, and manager features will not work until this is fixed.");
  }
  console.log(`Sales Companion server running on port ${PORT}`);
});
