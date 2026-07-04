(function(){
const { el, iconEl, clear } = window.DOMHelpers;
const { buildTopbar, showToast } = window.UIShared;
const { createConversation, buildChatThread, buildAskBar } = window.ConversationShared;

const PRIORITY_META = {
  low: { label: "Low priority", cls: "pill-gray" },
  medium: { label: "Medium priority", cls: "pill-amber" },
  high: { label: "High priority", cls: "pill-practice" },
};
const STATUS_META = {
  open: { label: "Open", cls: "pill-indigo" },
  won: { label: "Won", cls: "pill-green" },
  lost: { label: "Lost", cls: "pill-gray" },
  on_hold: { label: "On hold", cls: "pill-amber" },
};

function buildDealsScreen(onOpenInCoach) {
  let deals = [];
  let selectedId = null;
  let dealConv = createConversation(null);
  let showingForm = false;
  let documents = [];

  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });

  function getSelected() { return deals.find(d => d.id === selectedId) || null; }

  function selectDeal(id) {
    selectedId = id;
    showingForm = false;
    dealConv.reset(getSelected());
    loadDocuments();
    render();
  }

  async function loadDeals() {
    try {
      const res = await fetch("/api/deals", { credentials: "include" });
      const data = await res.json();
      deals = data.deals || [];
      if (deals.length > 0 && !selectedId) {
        selectedId = deals[0].id;
        dealConv.reset(deals[0]);
        loadDocuments();
      }
      render();
    } catch (e) {
      render();
      showToast("Couldn't load your deals.");
    }
  }

  async function loadDocuments() {
    if (!selectedId) { documents = []; return; }
    try {
      const res = await fetch(`/api/deals/${selectedId}/documents`, { credentials: "include" });
      const data = await res.json();
      documents = data.documents || [];
      render();
    } catch (e) {
      documents = [];
    }
  }

  async function createDeal(fields) {
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Couldn't save that deal.");
        return;
      }
      showingForm = false;
      await loadDeals();
      selectDeal(data.deal.id);
    } catch (e) {
      showToast("Couldn't reach the server.");
    }
  }

  async function deleteDeal(id) {
    if (!confirm("Remove this deal? This can't be undone.")) return;
    try {
      await fetch(`/api/deals/${id}`, { method: "DELETE", credentials: "include" });
      selectedId = null;
      await loadDeals();
    } catch (e) {
      showToast("Couldn't delete that deal.");
    }
  }

  async function uploadDocument(file) {
    if (!selectedId) return;
    const formData = new FormData();
    formData.append("file", file);
    showToast(`Uploading "${file.name}"…`);
    try {
      const res = await fetch(`/api/deals/${selectedId}/documents`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Couldn't upload that file.");
        return;
      }
      showToast(data.note || `"${file.name}" uploaded`);
      loadDocuments();
    } catch (e) {
      showToast("Couldn't reach the server.");
    }
  }

  // ---------- Add deal form ----------
  function buildAddDealForm() {
    const fields = {};
    const nameInput = el("input", { placeholder: "Deal / account name *", style: formInputStyle() });
    const companyInput = el("input", { placeholder: "Company", style: formInputStyle() });
    const ownerInput = el("input", { placeholder: "Deal owner (who's running this deal)", style: formInputStyle() });
    const peopleInput = el("input", { placeholder: "People involved (comma separated)", style: formInputStyle() });
    const valueInput = el("input", { placeholder: "Deal value ($)", type: "number", style: formInputStyle() });
    const timelineInput = el("input", { placeholder: "Target close date", type: "date", style: formInputStyle() });

    const priorityRow = el("div", { style: { display: "flex", gap: "8px" } });
    let priority = "medium";
    ["low", "medium", "high"].forEach(p => {
      const btn = el("button", {
        className: `pill pill-clickable ${priority === p ? "pill-navy" : "pill-gray"}`,
        onclick: () => { priority = p; renderPriorityRow(); },
      }, [PRIORITY_META[p].label]);
      priorityRow.appendChild(btn);
    });
    function renderPriorityRow() {
      Array.from(priorityRow.children).forEach((btn, i) => {
        const p = ["low", "medium", "high"][i];
        btn.className = `pill pill-clickable ${priority === p ? "pill-navy" : "pill-gray"}`;
      });
    }

    const notesInput = el("textarea", {
      placeholder: "Anything else worth knowing — context, history, concerns…",
      style: { ...formInputStyle(), minHeight: "70px", fontFamily: "inherit", resize: "vertical" },
    });

    // ---------- Upload-to-fill option ----------
    const uploadStatusSlot = el("div");
    const fileInput = el("input", { type: "file", accept: ".pdf,.docx,.txt,text/plain", style: { display: "none" } });
    fileInput.addEventListener("change", () => { if (fileInput.files.length) extractFromFile(fileInput.files[0]); });

    const uploadZone = el("div", {
      className: "card-flat",
      style: { display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", border: "1px dashed var(--line)" },
      onclick: () => fileInput.click(),
    }, [
      iconEl("file-text", 16, "var(--ink-soft)", 2),
      el("div", { style: { fontSize: "12.5px", color: "var(--ink-soft)" } }, [
        "Or upload a note, email, or brief (PDF, Word, or text) and let AI fill in the fields below \u2014 you'll still review everything before saving.",
      ]),
      fileInput,
    ]);

    async function extractFromFile(file) {
      clear(uploadStatusSlot);
      uploadStatusSlot.appendChild(
        el("div", { className: "card-flat", style: { display: "flex", gap: 10, alignItems: "center", background: "var(--indigo-soft)" } }, [
          el("div", { className: "typing-dots" }, [el("span"), el("span"), el("span")]),
          el("span", { style: { fontSize: 13, color: "var(--indigo-deep)" } }, [`Reading "${file.name}"…`]),
        ])
      );
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res = await fetch("/api/deals/extract", { method: "POST", credentials: "include", body: formData });
        const data = await res.json();
        clear(uploadStatusSlot);
        if (!res.ok) {
          uploadStatusSlot.appendChild(
            el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, [data.error || "Couldn't read that file."])
          );
          return;
        }

        // Pre-fill the existing fields — never auto-saved, the rep
        // reviews/edits everything below before clicking Save deal.
        if (data.name) nameInput.value = data.name;
        if (data.company) companyInput.value = data.company;
        if (data.dealOwner) ownerInput.value = data.dealOwner;
        if (Array.isArray(data.peopleInvolved) && data.peopleInvolved.length) peopleInput.value = data.peopleInvolved.join(", ");
        if (data.value) valueInput.value = data.value;
        if (data.timelineDate) timelineInput.value = data.timelineDate;
        if (data.priority && PRIORITY_META[data.priority]) { priority = data.priority; renderPriorityRow(); }
        if (data.notes) notesInput.value = data.notes;

        uploadStatusSlot.appendChild(
          el("div", { className: "card-flat", style: { background: "var(--green-bg)", color: "var(--green)", fontSize: 12.5, fontWeight: 600 } }, [
            "Filled in from the document \u2014 review the fields below, then save.",
          ])
        );
      } catch (e) {
        clear(uploadStatusSlot);
        uploadStatusSlot.appendChild(
          el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, ["Couldn't reach the server."])
        );
      }
    }

    const saveBtn = el("button", { className: "btn btn-primary" }, ["Save deal"]);
    saveBtn.onclick = () => {
      if (!nameInput.value.trim()) { showToast("A deal needs a name."); return; }
      const peopleInvolved = peopleInput.value.split(",").map(s => s.trim()).filter(Boolean);
      createDeal({
        name: nameInput.value.trim(),
        company: companyInput.value.trim() || null,
        dealOwner: ownerInput.value.trim() || null,
        peopleInvolved,
        value: valueInput.value ? Number(valueInput.value) : 0,
        timelineDate: timelineInput.value || null,
        priority,
        status: "open",
        notes: notesInput.value.trim() || null,
      });
    };

    const cancelBtn = el("button", { className: "btn btn-ghost", onclick: () => { showingForm = false; render(); } }, ["Cancel"]);

    return el("div", { className: "card", style: { display: "flex", flexDirection: "column", gap: "10px", maxWidth: "520px" } }, [
      el("div", { className: "label-eyebrow" }, ["New deal"]),
      uploadZone,
      uploadStatusSlot,
      el("div", { className: "divider", style: { margin: "4px 0" } }),
      nameInput, companyInput, ownerInput, peopleInput, valueInput, timelineInput,
      el("div", { className: "label-eyebrow", style: { marginTop: "4px" } }, ["Priority"]),
      priorityRow,
      notesInput,
      el("div", { style: { display: "flex", gap: "8px", marginTop: "6px" } }, [saveBtn, cancelBtn]),
    ]);
  }

  function formInputStyle() {
    return { border: "1px solid var(--line)", borderRadius: "10px", padding: "10px 12px", fontSize: "13.5px", width: "100%" };
  }

  function render() {
    clear(container);
    const selected = getSelected();

    container.appendChild(
      buildTopbar("Active deals", `${deals.length} open opportunit${deals.length === 1 ? "y" : "ies"} · saved to your account`, [
        el("button", { className: "btn btn-primary btn-sm", onclick: () => { showingForm = true; render(); } }, [iconEl("plus", 14, "#fff", 2), "Add deal"]),
      ])
    );

    const content = el("div", { className: "content", style: { display: "flex", gap: "24px" } });

    if (showingForm) {
      content.appendChild(buildAddDealForm());
      container.appendChild(content);
      return;
    }

    if (deals.length === 0) {
      content.appendChild(
        el("div", { className: "card", style: { margin: "0 auto", maxWidth: "420px", textAlign: "center", padding: "32px 24px" } }, [
          iconEl("briefcase", 28, "var(--ink-faint)", 1.6),
          el("div", { style: { fontSize: "15px", fontWeight: "700", marginTop: "12px" } }, ["No active deals yet"]),
          el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", marginTop: "6px", lineHeight: "1.5" } }, ["Add a deal to anchor a conversation to it — the AI will use whatever info you add when you ask it questions about that account."]),
          el("button", { className: "btn btn-primary", style: { marginTop: "16px" }, onclick: () => { showingForm = true; render(); } }, [iconEl("plus", 14, "#fff", 2), "Add your first deal"]),
        ])
      );
      container.appendChild(content);
      return;
    }

    // ---- left list ----
    const list = el("div", { style: { width: "340px", flex: "0 0 340px", display: "flex", flexDirection: "column", gap: "10px" } });
    deals.forEach(d => {
      const statusMeta = STATUS_META[d.status] || STATUS_META.open;
      list.appendChild(
        el("div", {
          className: "card",
          style: { padding: "14px 16px", cursor: "pointer", border: d.id === selectedId ? "1.5px solid var(--indigo)" : "0.5px solid var(--line)" },
          onclick: () => selectDeal(d.id),
        }, [
          el("div", { className: "row", style: { marginBottom: "8px" } }, [
            el("span", { style: { fontSize: "14px", fontWeight: "700" } }, [d.name]),
            el("span", { className: `pill ${statusMeta.cls}` }, [statusMeta.label]),
          ]),
          el("div", { className: "row" }, [
            el("span", { className: "mono", style: { fontSize: "13px", color: "var(--ink-soft)" } }, [d.value && Number(d.value) > 0 ? `$${Number(d.value).toLocaleString()}` : "—"]),
            d.id === selectedId ? el("span", { className: "pill pill-indigo" }, ["Anchored"]) : null,
          ]),
        ])
      );
    });
    content.appendChild(list);

    // ---- right detail ----
    const detail = el("div", { style: { flex: "1", display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" } });
    const statusMeta = STATUS_META[selected.status] || STATUS_META.open;
    const priorityMeta = PRIORITY_META[selected.priority] || PRIORITY_META.medium;

    detail.appendChild(
      el("div", { className: "card" }, [
        el("div", { className: "row" }, [
          el("div", null, [
            el("div", { style: { fontSize: "19px", fontWeight: "700" } }, [selected.name]),
            el("div", { style: { fontSize: "12.5px", color: "var(--ink-soft)", marginTop: "2px" } }, [
              selected.company || "No company set",
            ]),
          ]),
          el("div", { style: { display: "flex", gap: "8px" } }, [
            el("button", { className: "btn btn-primary btn-sm", onclick: () => onOpenInCoach(selected) }, [iconEl("sparkles", 14, "#fff", 2), "Open in Coach mode"]),
            el("button", { className: "btn btn-secondary btn-sm", onclick: () => loadRiskScore(selected.id) }, [iconEl("alert-triangle", 13, "var(--navy)", 2), " Risk score"]),
            el("button", { className: "icon-btn", title: "Delete deal", onclick: () => deleteDeal(selected.id) }, [iconEl("circle-x", 16, "var(--red)", 2)]),
          ]),
        ]),
        el("div", { style: { display: "flex", gap: "6px", marginTop: "10px", flexWrap: "wrap" } }, [
          el("span", { className: `pill ${statusMeta.cls}` }, [statusMeta.label]),
          el("span", { className: `pill ${priorityMeta.cls}` }, [priorityMeta.label]),
          selected.value && Number(selected.value) > 0 ? el("span", { className: "pill pill-gray" }, [`$${Number(selected.value).toLocaleString()}`]) : null,
          selected.timeline_date ? el("span", { className: "pill pill-gray" }, [`Closes ${selected.timeline_date}`]) : null,
        ]),
      ])
    );

    const factsGrid = el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" } });
    if (selected.deal_owner) {
      factsGrid.appendChild(
        el("div", { className: "card", style: { flex: 1 } }, [
          el("div", { className: "label-eyebrow", style: { marginBottom: "6px" } }, ["Deal owner"]),
          el("div", { style: { fontSize: "13.5px" } }, [selected.deal_owner]),
        ])
      );
    }
    if (Array.isArray(selected.people_involved) && selected.people_involved.length) {
      factsGrid.appendChild(
        el("div", { className: "card", style: { flex: 1 } }, [
          el("div", { className: "label-eyebrow", style: { marginBottom: "6px" } }, ["People involved"]),
          el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
            selected.people_involved.map(p => el("span", { className: "pill pill-gray" }, [p]))
          ),
        ])
      );
    }
    if (factsGrid.children.length > 0) detail.appendChild(factsGrid);

    if (selected.notes) {
      detail.appendChild(
        el("div", { className: "card-flat" }, [
          el("div", { className: "label-eyebrow", style: { marginBottom: "6px" } }, ["Notes"]),
          el("div", { style: { fontSize: "13px", lineHeight: "1.5" } }, [selected.notes]),
        ])
      );
    }

    // ---- documents ----
    detail.appendChild(el("div", { className: "label-eyebrow" }, ["Relevant documents"]));
    const docCard = el("div", { className: "card", style: { padding: "12px 16px" } });
    const fileInput = el("input", { type: "file", style: { display: "none" } });
    fileInput.addEventListener("change", () => { if (fileInput.files.length) uploadDocument(fileInput.files[0]); });
    docCard.appendChild(
      el("button", { className: "btn btn-secondary btn-sm", onclick: () => fileInput.click() }, [iconEl("file-text", 14, "var(--navy)", 2), "Upload a document"])
    );
    docCard.appendChild(fileInput);
    if (documents.length > 0) {
      const docList = el("div", { style: { marginTop: "10px", display: "flex", flexDirection: "column", gap: "6px" } });
      documents.forEach(d => {
        docList.appendChild(
          el("div", { style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" } }, [
            iconEl("circle-check", 14, "var(--assess)", 2.2),
            d.display_name,
          ])
        );
      });
      docCard.appendChild(docList);
    } else {
      docCard.appendChild(el("div", { style: { fontSize: "12.5px", color: "var(--ink-faint)", marginTop: "8px" } }, ["No documents uploaded for this deal yet."]));
    }
    detail.appendChild(docCard);

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

  // ---------- Deal risk score ----------
  const riskSlot = el("div");

  async function loadRiskScore(dealId) {
    const detailPanel = document.querySelector(".deal-detail-panel");
    const slotTarget = detailPanel || riskSlot;
    // Find or create a risk panel at the top of the detail area.
    let existing = document.getElementById("deal-risk-panel");
    if (existing) existing.remove();

    const riskPanel = el("div", { id: "deal-risk-panel" });
    riskPanel.appendChild(
      el("div", { className: "card-flat", style: { display: "flex", gap: 10, alignItems: "center" } }, [
        el("div", { className: "typing-dots" }, [el("span"), el("span"), el("span")]),
        el("span", { style: { fontSize: 13 } }, ["Scoring deal risk…"]),
      ])
    );

    // Insert at top of right panel content.
    const detailEl = document.querySelector(".deal-right-content");
    if (detailEl) {
      detailEl.prepend(riskPanel);
    }

    try {
      const res = await fetch(`/api/deals/${dealId}/risk`, { credentials: "include" });
      const data = await res.json();
      riskPanel.innerHTML = "";
      if (!res.ok) {
        riskPanel.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, [data.error || "Couldn't score this deal."]));
        return;
      }
      const riskColor = data.riskLevel === "high" ? "var(--red)" : data.riskLevel === "medium" ? "var(--amber)" : "var(--green)";
      const riskBg = data.riskLevel === "high" ? "var(--red-bg)" : data.riskLevel === "medium" ? "var(--amber-bg)" : "var(--green-bg)";
      const card = el("div", { className: "card", style: { border: `1.5px solid ${riskColor}`, background: riskBg } }, [
        el("div", { className: "row", style: { marginBottom: "8px" } }, [
          el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [
            iconEl("alert-triangle", 16, riskColor, 2),
            el("div", { style: { fontSize: "13.5px", fontWeight: "700", color: riskColor } }, [`${data.riskLevel.charAt(0).toUpperCase() + data.riskLevel.slice(1)} risk — ${data.score}/100`]),
          ]),
          el("button", { className: "icon-btn", onclick: () => riskPanel.remove() }, [iconEl("circle-x", 14, "var(--ink-faint)", 1.5)]),
        ]),
      ]);
      if (data.flags && data.flags.length) {
        data.flags.forEach(f => {
          card.appendChild(el("div", { style: { fontSize: "12.5px", color: riskColor, marginBottom: "4px" } }, [`⚠ ${f}`]));
        });
      }
      if (data.actions && data.actions.length) {
        card.appendChild(el("div", { style: { fontSize: "12px", fontWeight: "700", marginTop: "8px", marginBottom: "4px", color: "var(--ink-soft)" } }, ["Next actions:"]));
        data.actions.forEach(a => {
          card.appendChild(el("div", { style: { fontSize: "12.5px", marginBottom: "4px" } }, [`→ ${a}`]));
        });
      }
      riskPanel.appendChild(card);
    } catch (e) {
      riskPanel.innerHTML = "";
      riskPanel.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, ["Couldn't reach the server."]));
    }
  }

  dealConv.onChange(render);
  loadDeals();
  return container;
}

window.ScreenDeals = { buildDealsScreen };

})();
