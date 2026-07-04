# Sales Enablement AI Platform

A private, full-stack B2B web application designed for sales teams that combines an AI coach, a structured learning system, and an intelligent deal-tracking workspace. All securely grounded in your company's own uploaded documentation and public website. The AI strictly adheres to your custom knowledge base, ensuring zero hallucinations or invented company facts.

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Backend** | Node.js, Express |
| **Frontend** | Vanilla JS (No framework - custom DOM helper library) |
| **Database** | PostgreSQL (Neon serverless) |
| **AI / LLM** | Google Gemini API (`gemini-2.5-flash`) |
| **Auth** | Google Sign-In (OAuth 2.0), allowlist-gated |
| **File Storage** | Gemini File Search (Vector store for uploaded docs) |
| **Deployment** | Google Cloud Run + Render |
| **Document Gen** | `pptxgenjs` (Themed PPTX), `docx` (Word proposals) |

---

## 🚀 Key Features

### 🤖 AI Coach (4-in-1 Chat Modes)
* **Learn:** Teaches complex product/sales topics in-depth, securely grounded in uploaded company documentation.
* **Practice:** Initiates interactive roleplay acting as a skeptical prospect for objection handling drilling.
* **Coach:** Generates an instant pre-call brief tailored to a specific active deal.
* **Test:** Dynamically runs a 5-question scenario quiz and evaluates performance.
* **Smart Response Optimization:** Contextually detects "quick" or "briefly" keywords to auto-adjust response length.
* **Intelligent Website Fallback:** Dynamically falls back to the company’s public website if uploaded internal documents do not cover a user query.

### 📚 Learning Roadmap & Structured Paths
* Generates continuous learning paths containing 3-6 sequential lessons with multi-paragraph detailed content and highlighted key terms.
* Builds an automated 3-question quiz generated alongside the custom lesson text.
* **Quiz-Gated Progression:** Sales reps must score a passing grade (2/3+) to unlock successive lessons.
* Visual progress grouping equipped with functional progress bars, milestone badges, and full-path certificates.

### 📊 Analytics & Notes
* Real-time lesson progress tracking via interactive donut charts (Not Started, In Progress, Done, Overdue).
* Full historical tracking of quiz attempts, exact scores, and pass/fail metrics.
* Contextual note-taking overlay allowing reps to save and tag notes by topic directly alongside lessons with a full copy/delete library.

### 💼 CRM Deal Tracking Workspace
* Complete CRM-style interactive boards tracking company, owner, deal value, timeline, priority, and status.
* **AI Field Extraction:** Upload a note, client email, or brief (PDF, Word, TXT) to auto-extract and populate deal fields.
* **Deal Risk Scoring:** Predictive AI flags at-risk opportunities using explicit risk signals and triggers prescriptive next actions.

### 📄 Intelligent Document Generation
* **Battlecards:** On-demand competitor one-pagers identifying competitor strengths, your product advantages, trap discovery questions, and objection handling scripts.
* **Presentations (PPTX):** Generates fully themed slide decks with alternating layouts, cover slides, and color palettes pixel-matched to the company's brand.
* **Proposals (DOCX):** Structures formal proposals detailing an Executive Summary, Solution, Pricing, Timeline, and Next Steps.

### 📞 Call Performance Analysis
* Input call transcripts or audio recordings to receive an automated performance scorecard rated out of 10.
* Breaks down every customer objection raised and rates the response strategy.
* Pinpoints the top 2–3 core strengths, 2–3 required improvements, and a single core practice area focus.

### 👔 Manager & Onboarding Tools
* One-click assignments of entire custom onboarding tracks and lesson paths to specific reps.
* Manager dashboard with live completion statuses across the entire team, refreshing automatically every 30 seconds.

---

## 🏗️ Architecture Highlights

* **Secure Express Proxy:** All 11 distinct AI prompt configurations reside securely within the Express backend (`server.js`). The browser client never interfaces with Gemini directly, ensuring API keys and system prompts are never exposed to the frontend.
* **Two-Step Grounding Pattern:** Because Gemini's native File Search tool cannot be combined with strict JSON schema outputs in a single API call, generation routes follow a sequential pipeline: one grounded retrieval/drafting call, followed by a secondary JSON structural reshaping pass.
* **Dual-Context Web Fallback:** If internal file schemas fail to yield data, the backend automatically reroutes a second call utilizing Gemini's URL context tool to pull from the live public web interface.

---

## 💡 Key Insights Learned

1. **Gemini Tool Constraints:** Navigated the architectural boundary where File Search, JSON Schema styling, and live URL Context cannot run simultaneously in single calls, requiring multi-stage pipeline construction.
2. **Frameworkless Scalability:** Proved that a localized 5-function DOM helper library can securely replace bulky single-page application (SPA) frameworks for maintainable, lightning-fast UI scaling.
3. **Enterprise Brand Fidelity:** Discovered that pixel-sampling real components from production screenshots yields superior visual consistency over outdated or generic documentation palettes.
