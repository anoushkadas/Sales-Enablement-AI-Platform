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
    // Note: history logging now happens server-side in /api/chat, so
    // every exchange is captured regardless of which screen started it.
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
  messages.forEach((m, idx) => {
    let bubbleInner;
    if (m.role === "user") {
      bubbleInner = m.text; // plain text node — it's the user's own words, no highlighting needed
    } else {
      // Parent .bubble-ai CSS already sets white-space/font-size/line-height
      // to match; buildFormattedContent's own defaults are close enough
      // that no extra overrides are needed here.
      bubbleInner = window.ContentFormatter.buildFormattedContent(m.text, { fontSize: "14px", lineHeight: "1.65" });
    }
    const row = el("div", { className: `bubble-row ${m.role === "user" ? "user" : ""}` }, [
      el("div", { className: m.role === "user" ? "bubble-user" : "bubble-ai" }, [bubbleInner]),
    ]);
    wrap.appendChild(row);

    // Format controls (Text / Podcast) under every real assistant answer.
    // Skip on errors and on the very last message while still pending,
    // since there's nothing finished to narrate yet.
    if (m.role === "assistant" && !m.isError && m.text && m.text.trim()) {
      wrap.appendChild(buildFormatControls(m));
    }
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

// Per-message "Text / Podcast" format switcher. Text is the default,
// already-visible view (just a visual toggle, no re-fetch needed).
// Podcast calls /api/podcast on first click, then caches the resulting
// audio URL on the message object so switching back and forth doesn't
// re-generate (and re-bill) the same narration twice.
// Generalized: works for any object that has a `.text` (or equivalent)
// property and a place to cache `_podcastUrl` so switching tabs back and
// forth doesn't re-generate (and re-bill) the same narration twice.
// `textSource` can be a chat message ({role, text}) or any plain object
// with a `.text` field (e.g. a roadmap item wrapper) — both work the
// same way since generatePodcast only ever reads `.text`.
function buildFormatControls(textSource) {
  const container = el("div", { style: { display: "flex", flexDirection: "column", gap: 8, paddingLeft: 2 } });

  const tabRow = el("div", { style: { display: "flex", gap: 6 } });
  const playerSlot = el("div");
  const pptSlot = el("div");

  function renderTabs(active) {
    const { clear } = window.DOMHelpers;
    clear(tabRow);
    const tabs = [
      { id: "text", label: "Text", icon: "file-text" },
      { id: "podcast", label: "Podcast", icon: "headphones" },
    ];
    tabs.forEach(t => {
      tabRow.appendChild(
        el("button", {
          className: `pill pill-clickable ${active === t.id ? "pill-navy" : "pill-gray"}`,
          onclick: () => handleSelect(t.id),
        }, [iconEl(t.icon, 12, active === t.id ? "#fff" : "var(--ink-soft)", 2), " " + t.label])
      );
    });
    // "Create PPT" is an action, not a view toggle, so it's styled and
    // behaves differently from the Text/Podcast tabs even though it
    // lives in the same row.
    tabRow.appendChild(
      el("button", {
        className: "pill pill-gray pill-clickable",
        onclick: () => createPptFromText(textSource, pptSlot),
      }, [iconEl("layers", 12, "var(--ink-soft)", 2), " Create PPT"])
    );
  }

  function handleSelect(formatId) {
    const { clear } = window.DOMHelpers;
    renderTabs(formatId);
    clear(playerSlot);

    if (formatId === "text") return; // already visible above, nothing to render

    if (formatId === "podcast") {
      if (textSource._podcastUrl) {
        playerSlot.appendChild(buildAudioPlayer(textSource._podcastUrl));
        return;
      }
      generatePodcast(textSource, playerSlot);
    }
  }

  renderTabs("text");
  container.appendChild(tabRow);
  container.appendChild(playerSlot);
  container.appendChild(pptSlot);
  return container;
}

async function createPptFromText(textSource, pptSlot) {
  const { el, clear, iconEl } = window.DOMHelpers;
  clear(pptSlot);
  pptSlot.appendChild(
    el("div", { className: "card-flat", style: { display: "flex", gap: 10, alignItems: "center", padding: 12, marginTop: 8 } }, [
      el("div", { className: "typing-dots" }, [el("span"), el("span"), el("span")]),
      el("span", { style: { fontSize: 13 } }, ["Building a presentation from this…"]),
    ])
  );
  try {
    const res = await fetch("/api/generate/pptx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ topic: textSource.text, dealContext: null }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      clear(pptSlot);
      pptSlot.appendChild(
        el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13, padding: 12, marginTop: 8 } }, [
          body.error || `Couldn't generate that (status ${res.status}).`,
        ])
      );
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    clear(pptSlot);
    pptSlot.appendChild(
      el("div", { className: "card-flat", style: { padding: 12, marginTop: 8 } }, [
        el("a", { href: url, download: "lesson.pptx", className: "btn btn-primary btn-sm", style: { textDecoration: "none", display: "inline-flex" } }, [
          iconEl("download", 13, "#fff", 2), " Download presentation",
        ]),
      ])
    );
  } catch (e) {
    clear(pptSlot);
    pptSlot.appendChild(
      el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13, padding: 12, marginTop: 8 } }, ["Couldn't reach the server."])
    );
  }
}

function buildAudioPlayer(url) {
  const audio = el("audio", { controls: true, src: url, style: { width: "100%", maxWidth: 420 } });
  return el("div", { className: "card-flat", style: { padding: 12 } }, [audio]);
}

async function generatePodcast(textSource, playerSlot) {
  const { clear } = window.DOMHelpers;
  clear(playerSlot);
  playerSlot.appendChild(
    el("div", { className: "card-flat", style: { display: "flex", gap: 10, alignItems: "center", padding: 12 } }, [
      el("div", { className: "typing-dots" }, [el("span"), el("span"), el("span")]),
      el("span", { style: { fontSize: 13 } }, ["Narrating this lesson…"]),
    ])
  );

  try {
    const res = await fetch("/api/podcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ text: textSource.text }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      clear(playerSlot);
      playerSlot.appendChild(
        el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13, padding: 12 } }, [
          body.error || `Couldn't generate audio (status ${res.status}).`,
        ])
      );
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    textSource._podcastUrl = url; // cache so re-selecting Podcast doesn't re-generate
    clear(playerSlot);
    playerSlot.appendChild(buildAudioPlayer(url));
  } catch (e) {
    clear(playerSlot);
    playerSlot.appendChild(
      el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13, padding: 12 } }, [
        "Couldn't reach the server. Try again.",
      ])
    );
  }
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

  // Voice input — uses the browser's built-in Web Speech API. Free, no
  // server round trip, no API key. Supported in Chrome, Edge, and
  // Safari; not in Firefox, so the mic button simply doesn't render
  // there rather than showing something broken.
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  let micBtn = null;
  if (SpeechRecognitionImpl && !opts.hideVoice) {
    let listening = false;
    let recognition = null;

    micBtn = el("button", {
      className: "icon-btn",
      "aria-label": "Speak your question",
      title: "Speak your question",
      onclick: () => {
        if (listening) {
          recognition && recognition.stop();
          return;
        }
        recognition = new SpeechRecognitionImpl();
        recognition.lang = "en-US";
        recognition.interimResults = true;
        recognition.continuous = false;

        recognition.onstart = () => {
          listening = true;
          micBtn.style.background = "var(--red-bg)";
          micBtn.style.borderColor = "var(--red)";
          window.DOMHelpers.clear(micBtn);
          micBtn.appendChild(iconEl("mic", 16, "var(--red)", 2));
        };

        recognition.onresult = (event) => {
          let transcript = "";
          for (let i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          input.value = transcript;
          opts.onChange(transcript);
        };

        recognition.onerror = (event) => {
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            window.UIShared.showToast("Microphone access was blocked — check your browser's site permissions.");
          } else if (event.error !== "no-speech" && event.error !== "aborted") {
            window.UIShared.showToast("Couldn't hear that — try again.");
          }
        };

        recognition.onend = () => {
          listening = false;
          micBtn.style.background = "";
          micBtn.style.borderColor = "";
          window.DOMHelpers.clear(micBtn);
          micBtn.appendChild(iconEl("mic", 16, "var(--ink)", 1.8));
        };

        recognition.start();
      },
    }, [iconEl("mic", 16, "var(--ink)", 1.8)]);
  }

  const barChildren = [iconEl("sparkles", 18, "var(--indigo)", 1.9), input];
  if (micBtn) barChildren.push(micBtn);
  barChildren.push(sendBtn);

  const bar = el("div", { className: "ask-bar" }, barChildren);
  bar.focusInput = () => input.focus();
  bar.clear = () => { input.value = ""; };
  return bar;
}

window.ConversationShared = { createConversation, buildChatThread, buildPills, buildAskBar, buildFormatControls, buildAudioPlayer };

})();
