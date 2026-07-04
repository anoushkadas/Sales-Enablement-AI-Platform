(function(){
// =====================================================================
// APP DATA
//
// Deals, lesson plans, the learning roadmap, chat history, and now
// analytics counts are all loaded live from the server's database (see
// server/db.js) — nothing in this file holds that data anymore. What's
// left here is genuinely static UI content: mode tile copy and
// suggested prompts.
// =====================================================================

const SUGGESTED_PROMPTS = [
  { icon: 'target', text: 'What do we know about our top competitor?' },
  { icon: 'mic', text: 'Drill me on a common objection' },
  { icon: 'book', text: 'Teach me about our product' },
];

const RESUME_CARDS = [];

const MODES = [
  { id: 'learn', label: 'Learn', desc: 'Study a topic, industry, or persona from scratch', icon: 'book', bg: 'var(--line-soft)', deep: 'var(--navy)' },
  { id: 'practice', label: 'Practice', desc: 'Roleplay a call or drill objections with AI', icon: 'mic', bg: 'var(--practice-bg)', deep: 'var(--practice-deep)' },
  { id: 'coach', label: 'Coach', desc: 'Get a tailored brief before a real meeting', icon: 'bulb', bg: 'var(--indigo-soft)', deep: 'var(--indigo-deep)' },
  { id: 'test', label: 'Test', desc: 'Check your readiness with a scenario quiz', icon: 'clipboard-check', bg: 'var(--sage-bg)', deep: 'var(--sage-deep)' },
];

window.APP_DATA = { SUGGESTED_PROMPTS, RESUME_CARDS, MODES };
})();
