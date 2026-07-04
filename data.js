(function(){
// =====================================================================
// APP DATA
//
// This starts empty on purpose — no invented example deals, lessons,
// or history. Real deals/lessons/history will come from wherever you
// decide to connect later (a CRM, a spreadsheet, or just manual entry
// screens you add). The Knowledge the AI uses to answer questions
// comes entirely from documents you upload on the Knowledge screen —
// see knowledge.js — not from anything in this file.
// =====================================================================

const DEALS = [];
const PAST_LESSONS = [];
const FUTURE_LESSONS = [];
const HISTORY_LOG = [];

const ANALYTICS = {
  overallReadiness: { value: '—', delta: '' },
  managerScore: { value: '—', delta: '' },
  practiceReps: { value: '—', delta: '' },
  timeToFirstDeal: { value: '—', delta: '' },
  scoreTrend: [],
  practiceMix: [],
  skillByStage: [],
  badges: [],
};

const SUGGESTED_PROMPTS = [
  { icon: 'target', text: 'What do we know about our top competitor?' },
  { icon: 'mic', text: 'Drill me on a common objection' },
  { icon: 'book', text: 'Teach me about our product' },
];

const RESUME_CARDS = [];

const MODES = [
  { id: 'learn', label: 'Learn', desc: 'Study a topic, industry, or persona from scratch', icon: 'book', bg: 'var(--learn-bg)', deep: 'var(--learn-deep)' },
  { id: 'practice', label: 'Practice', desc: 'Roleplay a call or drill objections with AI', icon: 'mic', bg: 'var(--practice-bg)', deep: 'var(--practice-deep)' },
  { id: 'coach', label: 'Coach', desc: 'Get a tailored brief before a real meeting', icon: 'bulb', bg: 'var(--indigo-soft)', deep: 'var(--indigo-deep)' },
  { id: 'test', label: 'Test', desc: 'Check your readiness with a scenario quiz', icon: 'clipboard-check', bg: 'var(--assess-bg)', deep: 'var(--assess-deep)' },
];

window.APP_DATA = { DEALS, PAST_LESSONS, FUTURE_LESSONS, HISTORY_LOG, ANALYTICS, SUGGESTED_PROMPTS, RESUME_CARDS, MODES };
})();
