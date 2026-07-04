(function(){
const { el, iconEl, clear } = window.DOMHelpers;
const { buildTopbar } = window.UIShared;
const { buildChatThread, buildPills, buildAskBar } = window.ConversationShared;

function buildHomeScreen(conv, onShowToast, userEmail) {
  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });

  function greetingName() {
    if (!userEmail) return "there";
    const local = userEmail.split("@")[0];
    return local.split(/[._]/)[0].replace(/^(.)/, (c) => c.toUpperCase());
  }

  function todayLabel() {
    return new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }

  function render() {
    clear(container);
    const hasStarted = conv.state.messages.length > 0;

    if (hasStarted) {
      container.appendChild(
        buildTopbar(
          "Conversation",
          conv.state.anchoredDeal ? `Anchored to ${conv.state.anchoredDeal.name}` : "Not anchored to a deal",
          [el("button", { className: "btn btn-secondary btn-sm", onclick: () => conv.reset() }, [iconEl("plus", 14), "New conversation"])]
        )
      );

      const scrollArea = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 } });
      scrollArea.appendChild(buildChatThread(conv.state.messages, conv.state.pending, handleSend));

      // pills only on the most recent assistant message in this simple build
      const last = conv.state.messages[conv.state.messages.length - 1];
      if (last && last.role === "assistant" && last.pills) {
        scrollArea.appendChild(buildPills(last.pills, handleSend));
      }

      const askBar = buildAskBar({
        placeholder: "Ask a follow-up…",
        disabled: conv.state.pending,
        onSubmit: (text) => { askBar.clear(); handleSend(text); },
      });
      scrollArea.appendChild(askBar);
      container.appendChild(scrollArea);
      setTimeout(() => { scrollArea.scrollTop = scrollArea.scrollHeight; askBar.focusInput(); }, 0);
      return;
    }

    container.appendChild(
      buildTopbar(`Good day, ${greetingName()}`, todayLabel(), [
        el("button", { className: "icon-btn" }, [iconEl("bell", 17)]),
        el("button", { className: "icon-btn" }, [iconEl("settings", 17)]),
      ])
    );

    const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 48 } });

    content.appendChild(
      el("div", { style: { textAlign: "center", marginBottom: 32 } }, [
        el("div", { style: { fontSize: "26px", fontWeight: "700", marginBottom: "8px" } }, ["What do you want to do?"]),
        el("div", { style: { fontSize: "14.5px", color: "var(--ink-soft)" } }, ["Pick a mode, or just ask a question below — I'll figure out the rest."]),
      ])
    );

    const tileGrid = el("div", { className: "mode-tile-grid", style: { display: "grid", gridTemplateColumns: "220px 220px 220px 220px", gap: "16px", marginBottom: "28px" } });
    window.APP_DATA.MODES.forEach(m => {
      tileGrid.appendChild(
        el("button", { className: "mode-tile", onclick: () => handleSend(`Let's start a ${m.label} session.`) }, [
          el("div", { className: "ic-wrap", style: { background: m.bg } }, [iconEl(m.icon, 19, m.deep)]),
          el("div", { className: "title" }, [m.label]),
          el("div", { className: "desc" }, [m.desc]),
        ])
      );
    });
    content.appendChild(tileGrid);

    const askWrap = el("div", { style: { width: "100%", maxWidth: "740px" } });
    const askBar = buildAskBar({
      onSubmit: (text) => { askBar.clear(); handleSend(text); },
      disabled: conv.state.pending,
    });
    askWrap.appendChild(askBar);

    const promptRow = el("div", { style: { display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap", justifyContent: "center" } });
    window.APP_DATA.SUGGESTED_PROMPTS.forEach(p => {
      promptRow.appendChild(
        el("button", { className: "ai-chip", onclick: () => handleSend(p.text) }, [
          el("span", { className: "ic" }, [iconEl(p.icon, 14, "var(--indigo)", 2)]),
          p.text,
        ])
      );
    });
    askWrap.appendChild(promptRow);
    content.appendChild(askWrap);

    if (window.APP_DATA.RESUME_CARDS.length > 0) {
      const resumeWrap = el("div", { style: { width: "100%", maxWidth: "900px", marginTop: "48px" } });
      resumeWrap.appendChild(el("div", { className: "label-eyebrow", style: { marginBottom: "12px" } }, ["Pick up where you left off"]));
      const resumeGrid = el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" } });
      window.APP_DATA.RESUME_CARDS.forEach(c => {
        resumeGrid.appendChild(
          el("div", { className: "card", style: { display: "flex", gap: "14px", alignItems: "center", cursor: "pointer" }, onclick: () => onShowToast("Resuming where you left off") }, [
            el("div", { style: { width: "38px", height: "38px", borderRadius: "10px", background: c.iconBg, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 38px" } }, [iconEl(c.icon, 18, c.iconColor)]),
            el("div", { style: { flex: "1" } }, [
              el("div", { style: { fontSize: "13.5px", fontWeight: "700" } }, [c.title]),
              el("div", { style: { fontSize: "12px", color: "var(--ink-soft)" } }, [c.note]),
            ]),
            iconEl("chevron-right", 17, "var(--ink-faint)", 2),
          ])
        );
      });
      resumeWrap.appendChild(resumeGrid);
      content.appendChild(resumeWrap);
    }

    container.appendChild(content);
  }

  function handleSend(text) {
    conv.send(text);
  }

  conv.onChange(render);
  render();
  return container;
}

window.ScreenHome = { buildHomeScreen };

})();
