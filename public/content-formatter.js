(function(){
// Renders lesson content with formatting for readability.
//
// PRIMARY highlighting: **double asterisk** markers embedded by the
// model in lesson content (e.g. **Total Cost of Ownership**) — these
// are deliberately placed by the AI at generation time, which is far
// more reliable than guessing at "important words" with regex after the
// fact. An earlier version tried regex-based capitalized-phrase
// detection; it was removed after it repeatedly produced wrong results
// (missing "Return on Investment", incorrectly splitting "Net Promoter
// Score" into two fragments, etc.). This approach is the correct one.
//
// SECONDARY highlighting (still present, for content that pre-dates
// the **marker** convention): quoted phrases and dollar/percentage
// numbers — both tested reliable in every case tried.
//
// Security: raw text is HTML-escaped FIRST, then markers are replaced
// with tags — unescaped content never reaches innerHTML.

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightKeyTerms(escapedText) {
  let html = escapedText;

  // 1. **double asterisk** key terms — primary, model-placed markers.
  //    These survive HTML escaping unchanged (asterisks are not HTML
  //    special chars) so the pattern is straightforward.
  html = html.replace(/\*\*([^*\n]{2,80}?)\*\*/g, '<mark class="cf-term">$1</mark>');

  // 2. Quoted phrases — suggested talk tracks, objection language,
  //    memorable phrases. Styled as italic+colored so they read as
  //    "notable," not bolded like key terms.
  html = html.replace(/&quot;([^&]{3,60}?)&quot;/g, '&quot;<em class="cf-quote">$1</em>&quot;');

  // 3. Dollar amounts and percentages — concrete numbers that benefit
  //    from immediate visual scan.
  html = html.replace(/(\$[\d,]+(?:\.\d+)?[KMB]?|\b\d+(?:\.\d+)?%)/g, '<strong class="cf-number">$1</strong>');

  return html;
}

function buildFormattedContent(rawText, opts) {
  opts = opts || {};
  const node = document.createElement("div");
  node.style.whiteSpace = "pre-wrap";
  node.style.lineHeight = opts.lineHeight || "1.6";
  node.style.fontSize = opts.fontSize || "13px";
  if (opts.color) node.style.color = opts.color;
  if (opts.marginBottom) node.style.marginBottom = opts.marginBottom;

  const escaped = escapeHtml(rawText || "");
  node.innerHTML = highlightKeyTerms(escaped);

  // Key terms: highlighted background + bold, reads as a textbook
  // highlight rather than just colored text.
  node.querySelectorAll(".cf-term").forEach(s => {
    s.style.background = "var(--indigo-soft)";
    s.style.color = "var(--indigo-deep)";
    s.style.fontWeight = "700";
    s.style.borderRadius = "3px";
    s.style.padding = "0 3px";
  });
  // Quoted phrases: italic + colored, reads as "notable talk track."
  node.querySelectorAll(".cf-quote").forEach(s => {
    s.style.color = "var(--indigo-deep)";
    s.style.fontStyle = "italic";
    s.style.fontWeight = "600";
  });
  // Numbers: bold color only, short enough not to need background.
  node.querySelectorAll(".cf-number").forEach(s => {
    s.style.color = "var(--indigo-deep)";
    s.style.fontWeight = "700";
  });

  return node;
}

window.ContentFormatter = { buildFormattedContent, escapeHtml, highlightKeyTerms };

})();
