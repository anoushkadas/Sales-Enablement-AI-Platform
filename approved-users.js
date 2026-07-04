// =====================================================================
// APPROVED USERS — edit this list, save, and redeploy to add/remove
// who's allowed to sign in.
//
// Add one email per line, exactly as it appears in their Google
// account (lowercase, no typos — matching is case-insensitive but
// must otherwise be exact).
// =====================================================================

const APPROVED_EMAILS = [
  "anoushka.das20@gmail.com",
  // "teammate@example.com",
  // "another.person@example.com",
];

module.exports = {
  isApproved(email) {
    if (!email) return false;
    const normalized = email.trim().toLowerCase();
    return APPROVED_EMAILS.map(e => e.trim().toLowerCase()).includes(normalized);
  },
  APPROVED_EMAILS,
};
