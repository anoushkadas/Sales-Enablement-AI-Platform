(function(){
const { el, iconEl } = window.DOMHelpers;

// A simple observable conversation object. Call .onChange(fn) to subscribe
// to re-renders whenever messages/pending state changes.
function createConversation(initialDeal) {
  const state = {
    messages: [],
    pending: false,
    anchoredDeal: initialDeal || null,
    listeners: [],
  };

  function notify() { state.listeners.forEach(fn => fn(state)); }

  async function send(text) {
    if (!text || !text.trim() || state.pending) return;
    const userText = text.trim();
    state.messages.push({ role: "user", text: userText });
    state.pending = true;
    notify();
    const result = await window.callGemini(state.messages, state.anchoredDeal);
    state.pending = false;
    state.messages.push({ role: "assistant", text: result.text, isError: result.error });
    notify();

    if (!result.error && window.APP_DATA && Array.isArray(window.APP_DATA.HISTORY_LOG)) {
      window.APP_DATA.HISTORY_LOG.unshift({
        q: userText,
        a: result.text,
        tag: "General",
        tagClass: "pill-gray",
        when: "Just now",
      });
    }
  }

  function reset(deal) {
    state.messages = [];
    state.pending = false;
    state.anchoredDeal = deal || null;
    notify();
  }

  function onChange(fn) { state.listeners.push(fn); }

  return { state, send, reset, onChange };
}

function buildChatThread(messages, pending, onPillClick) {
  const wrap = el("div", { style: { display: "flex", flexDirection: "column", gap: 16 } });
  messages.forEach(m => {
    const row = el("div", { className: `bubble-row ${m.role === "user" ? "user" : ""}` }, [
      el("div", { className: m.role === "user" ? "bubble-user" : "bubble-ai" }, [m.text]),
    ]);
    wrap.appendChild(row);
  });
  if (pending) {
    wrap.appendChild(
      el("div", { className: "bubble-row" }, [
        el("div", { className: "bubble-ai" }, [
          el("div", { className: "typing-dots" }, [el("span"), el("span"), el("span")]),
        ]),
      ])
    );
  }
  return wrap;
}

function buildPills(pills, onClick) {
  if (!pills || !pills.length) return null;
  return el("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", paddingLeft: 2 } },
    pills.map(p =>
      el("button", { className: "ai-chip", onclick: () => onClick(p.prompt || p.text) }, [
        el("span", { className: "ic" }, [iconEl(p.icon, 14, "var(--indigo)", 2)]),
        p.text,
      ])
    )
  );
}

function buildAskBar(opts) {
  const input = el("input", {
    value: opts.value || "",
    placeholder: opts.placeholder || "Ask a question, paste a prospect's note, or describe a deal…",
    oninput: e => opts.onChange(e.target.value),
    onkeydown: e => { if (e.key === "Enter" && input.value.trim() && !opts.disabled) opts.onSubmit(input.value); },
    disabled: !!opts.disabled,
  });
  const sendBtn = el("button", {
    className: "icon-btn",
    style: { background: "var(--navy)", border: "none" },
    "aria-label": "Send",
    onclick: () => input.value.trim() && !opts.disabled && opts.onSubmit(input.value),
  }, [iconEl("send", 15, "#fff", 2)]);

  const bar = el("div", { className: "ask-bar" }, [
    iconEl("sparkles", 18, "var(--indigo)", 1.9),
    input,
    sendBtn,
  ]);
  bar.focusInput = () => input.focus();
  bar.clear = () => { input.value = ""; };
  return bar;
}

window.ConversationShared = { createConversation, buildChatThread, buildPills, buildAskBar };

})();
