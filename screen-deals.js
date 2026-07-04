(function(){
const { el, iconEl, clear } = window.DOMHelpers;
const { buildTopbar, showToast } = window.UIShared;
const { createConversation, buildChatThread, buildAskBar } = window.ConversationShared;

function buildDealsScreen(onOpenInCoach) {
  let DEALS = window.APP_DATA.DEALS; // in-memory only — see README about persistence
  let selectedId = DEALS.length ? DEALS[0].id : null;
  let dealConv = createConversation(DEALS.length ? DEALS[0] : null);

  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });

  function getSelected() { return DEALS.find(d => d.id === selectedId) || null; }

  function selectDeal(id) {
    selectedId = id;
    dealConv.reset(getSelected());
    render();
  }

  function addDeal() {
    const name = prompt("Deal / account name?");
    if (!name) return;
    const industry = prompt("Industry? (optional)") || "";
    const notes = prompt("Anything else worth knowing for this deal? (optional — competitors, tech stack, etc.)") || "";
    const newDeal = {
      id: "deal-" + Date.now(),
      name,
      stage: "Planning",
      stageClass: "pill-gray",
      value: 0,
      closes: "—",
      industry: industry || "—",
      industryDetail: "",
      techStack: [],
      competitors: [],
      stakeholders: [],
      notes,
    };
    DEALS.push(newDeal);
    selectedId = newDeal.id;
    dealConv.reset(newDeal);
    render();
  }

  function render() {
    clear(container);
    const selected = getSelected();

    container.appendChild(
      buildTopbar("Active deals", `${DEALS.length} open opportunit${DEALS.length === 1 ? "y" : "ies"} · stored in this browser session only`, [
        el("button", { className: "btn btn-primary btn-sm", onclick: addDeal }, [iconEl("plus", 14, "#fff", 2), "Add deal"]),
      ])
    );

    const content = el("div", { className: "content", style: { display: "flex", gap: "24px" } });

    if (DEALS.length === 0) {
      content.appendChild(
        el("div", { className: "card", style: { margin: "0 auto", maxWidth: "420px", textAlign: "center", padding: "32px 24px" } }, [
          iconEl("briefcase", 28, "var(--ink-faint)", 1.6),
          el("div", { style: { fontSize: "15px", fontWeight: "700", marginTop: "12px" } }, ["No active deals yet"]),
          el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", marginTop: "6px", lineHeight: "1.5" } }, ["Add a deal to anchor a conversation to it — the AI will use whatever notes you add when you ask it questions about that account."]),
          el("button", { className: "btn btn-primary", style: { marginTop: "16px" }, onclick: addDeal }, [iconEl("plus", 14, "#fff", 2), "Add your first deal"]),
        ])
      );
      container.appendChild(content);
      return;
    }

    // ---- left list ----
    const list = el("div", { style: { width: "340px", flex: "0 0 340px", display: "flex", flexDirection: "column", gap: "10px" } });
    DEALS.forEach(d => {
      list.appendChild(
        el("div", {
          className: "card",
          style: { padding: "14px 16px", cursor: "pointer", border: d.id === selectedId ? "1.5px solid var(--indigo)" : "0.5px solid var(--line)" },
          onclick: () => selectDeal(d.id),
        }, [
          el("div", { className: "row", style: { marginBottom: "8px" } }, [
            el("span", { style: { fontSize: "14px", fontWeight: "700" } }, [d.name]),
            el("span", { className: `pill ${d.stageClass}` }, [d.stage]),
          ]),
          el("div", { className: "row" }, [
            el("span", { className: "mono", style: { fontSize: "13px", color: "var(--ink-soft)" } }, [d.value ? `$${d.value.toLocaleString()}` : "—"]),
            d.id === selectedId ? el("span", { className: "pill pill-indigo" }, ["Anchored"]) : null,
          ]),
        ])
      );
    });
    content.appendChild(list);

    // ---- right detail ----
    const detail = el("div", { style: { flex: "1", display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" } });

    detail.appendChild(
      el("div", { className: "card" }, [
        el("div", { className: "row" }, [
          el("div", null, [
            el("div", { style: { fontSize: "19px", fontWeight: "700" } }, [selected.name]),
            el("div", { style: { fontSize: "12.5px", color: "var(--ink-soft)", marginTop: "2px" } }, [
              `${selected.value ? "$" + selected.value.toLocaleString() : "Value not set"} · ${selected.stage} stage`,
            ]),
          ]),
          el("button", { className: "btn btn-primary btn-sm", onclick: () => onOpenInCoach(selected) }, [iconEl("sparkles", 14, "#fff", 2), "Open in Coach mode"]),
        ]),
      ])
    );

    if (selected.notes) {
      detail.appendChild(
        el("div", { className: "card-flat" }, [
          el("div", { className: "label-eyebrow", style: { marginBottom: "6px" } }, ["Notes"]),
          el("div", { style: { fontSize: "13px", lineHeight: "1.5" } }, [selected.notes]),
        ])
      );
    }

    detail.appendChild(el("div", { className: "label-eyebrow" }, ["Ask about this deal"]));
    const askBar = buildAskBar({
      placeholder: `Ask anything about ${selected.name}…`,
      disabled: dealConv.state.pending,
      onSubmit: (text) => { askBar.clear(); dealConv.send(text); },
    });
    detail.appendChild(askBar);

    if (dealConv.state.messages.length > 0) {
      detail.appendChild(buildChatThread(dealConv.state.messages, dealConv.state.pending, () => {}));
    }

    content.appendChild(detail);
    container.appendChild(content);
  }

  dealConv.onChange(render);
  render();
  return container;
}

window.ScreenDeals = { buildDealsScreen };

})();
