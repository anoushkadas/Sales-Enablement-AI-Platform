(function(){
const { el, iconEl, clear } = window.DOMHelpers;
const { buildTopbar, showToast } = window.UIShared;

function buildGenerateScreen() {
  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });

  let activeTab = "files"; // "files" | "battlecard"
  const topbarSlot = el("div");
  container.appendChild(topbarSlot);

  function renderTopbar() {
    clear(topbarSlot);
    topbarSlot.appendChild(
      buildTopbar("Generate", "Create decks, proposals, and competitor battlecards", [
        el("div", { style: { display: "flex", gap: "6px" } }, [
          el("button", {
            className: `pill pill-clickable ${activeTab === "files" ? "pill-navy" : "pill-gray"}`,
            onclick: () => { activeTab = "files"; renderTopbar(); renderBody(); },
          }, [iconEl("layers", 12, activeTab === "files" ? "#fff" : "var(--ink-soft)", 2), " PPT / Word"]),
          el("button", {
            className: `pill pill-clickable ${activeTab === "battlecard" ? "pill-navy" : "pill-gray"}`,
            onclick: () => { activeTab = "battlecard"; renderTopbar(); renderBody(); },
          }, [iconEl("shield-check", 12, activeTab === "battlecard" ? "#fff" : "var(--ink-soft)", 2), " Battlecards"]),
        ]),
      ])
    );
  }

  const bodySlot = el("div", { style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column" } });
  container.appendChild(bodySlot);

  function renderBody() {
    clear(bodySlot);
    if (activeTab === "files") bodySlot.appendChild(buildFilesTab());
    else bodySlot.appendChild(buildBattlecardTab());
  }

  function buildFilesTab() {
    const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "18px", maxWidth: "640px" } });
    let selectedDeal = null;
    let format = "pptx";

    content.appendChild(
      el("div", { className: "card-flat", style: { background: "var(--indigo-soft)" } }, [
        el("div", { style: { fontSize: "12.5px", lineHeight: "1.5", color: "var(--indigo-deep)" } }, [
          "Generates a real, downloadable file — grounded in whatever you've uploaded to Knowledge, plus the linked deal's info if you pick one. Takes 15-30 seconds.",
        ]),
      ])
    );

    content.appendChild(el("div", { className: "label-eyebrow" }, ["What do you want to create?"]));
    const formatRow = el("div", { style: { display: "flex", gap: "12px" } });
    function renderFormatRow() {
      clear(formatRow);
      [
        { id: "pptx", label: "Presentation (PPT)", icon: "layers", desc: "Slide deck with headings and bullets" },
        { id: "docx", label: "Proposal (Word)", icon: "file-text", desc: "Sections: summary, solution, pricing, timeline" },
      ].forEach(f => {
        const selected = format === f.id;
        formatRow.appendChild(
          el("button", {
            className: "mode-tile",
            style: { border: selected ? "1.5px solid var(--indigo)" : "1px solid var(--line)", flex: "1" },
            onclick: () => { format = f.id; renderFormatRow(); },
          }, [
            el("div", { className: "ic-wrap", style: { background: "var(--indigo-soft)" } }, [iconEl(f.icon, 19, "var(--indigo-deep)")]),
            el("div", { className: "title" }, [f.label]),
            el("div", { className: "desc" }, [f.desc]),
          ])
        );
      });
    }
    renderFormatRow();
    content.appendChild(formatRow);

    content.appendChild(el("div", { className: "label-eyebrow" }, ["Link a deal (optional)"]));
    const dealPickerSlot = el("div");
    dealPickerSlot.appendChild(window.DealPicker.buildDealPicker(null, (deal) => { selectedDeal = deal; }));
    content.appendChild(dealPickerSlot);

    content.appendChild(el("div", { className: "label-eyebrow" }, ["Title (optional — leave blank to let AI name it)"]));
    const titleInput = el("input", {
      placeholder: "e.g. \"Acme Corp Q3 Renewal Proposal\"",
      style: { border: "1px solid var(--line)", borderRadius: "10px", padding: "12px 14px", fontSize: "13.5px" },
    });
    content.appendChild(titleInput);

    content.appendChild(el("div", { className: "label-eyebrow" }, ["Topic / brief"]));
    const topicInput = el("textarea", {
      placeholder: "e.g. \"Proposal for Acme Corp's Q3 renewal, focused on the new analytics module\"",
      style: { border: "1px solid var(--line)", borderRadius: "10px", padding: "12px 14px", fontSize: "13.5px", minHeight: "90px", fontFamily: "inherit", resize: "vertical" },
    });
    content.appendChild(topicInput);

    const generateBtn = el("button", { className: "btn btn-primary" }, [iconEl("sparkles", 14, "#fff", 2), "Generate"]);
    content.appendChild(generateBtn);

    const statusSlot = el("div");
    content.appendChild(statusSlot);

    generateBtn.onclick = async () => {
      const topic = topicInput.value.trim();
      if (!topic) { showToast("Describe what you want generated first."); return; }
      const customTitle = titleInput.value.trim();
      clear(statusSlot);
      generateBtn.disabled = true;
      statusSlot.appendChild(
        el("div", { className: "card-flat", style: { display: "flex", gap: 10, alignItems: "center" } }, [
          el("div", { className: "typing-dots" }, [el("span"), el("span"), el("span")]),
          el("span", { style: { fontSize: 13 } }, [format === "pptx" ? "Building your presentation…" : "Drafting your proposal…"]),
        ])
      );
      try {
        const res = await fetch(`/api/generate/${format}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ topic, dealContext: selectedDeal, customTitle }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          clear(statusSlot);
          statusSlot.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, [body.error || `Error ${res.status}`]));
          return;
        }
        const disposition = res.headers.get("Content-Disposition") || "";
        const match = disposition.match(/filename="([^"]+)"/);
        const filename = match ? match[1] : `generated.${format}`;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        clear(statusSlot);
        statusSlot.appendChild(
          el("div", { className: "card-flat", style: { background: "var(--green-bg)", display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-start" } }, [
            el("div", { style: { fontSize: 13, color: "var(--green)", fontWeight: 600 } }, ["Ready. Also saved to History → Generated content."]),
            el("a", { href: url, download: filename, className: "btn btn-primary", style: { textDecoration: "none" } }, [iconEl("download", 14, "#fff", 2), `Download ${filename}`]),
          ])
        );
      } catch (e) {
        clear(statusSlot);
        statusSlot.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, ["Couldn't reach the server."]));
      } finally {
        generateBtn.disabled = false;
      }
    };

    return content;
  }

  function buildBattlecardTab() {
    const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "720px" } });
    content.appendChild(el("div", { className: "label-eyebrow" }, ["Competitor name"]));
    const competitorInput = el("input", {
      placeholder: "e.g. NetApp, Dell EMC, HPE…",
      style: { border: "1px solid var(--line)", borderRadius: "10px", padding: "12px 14px", fontSize: "13.5px" },
    });
    content.appendChild(competitorInput);

    const buildBtn = el("button", { className: "btn btn-primary" }, [iconEl("sparkles", 14, "#fff", 2), " Build battlecard"]);
    content.appendChild(buildBtn);
    const resultSlot = el("div");
    content.appendChild(resultSlot);

    async function build() {
      const competitor = competitorInput.value.trim();
      if (!competitor) { showToast("Enter a competitor name first."); return; }
      clear(resultSlot);
      buildBtn.disabled = true;
      resultSlot.appendChild(
        el("div", { className: "card-flat", style: { display: "flex", gap: 10, alignItems: "center" } }, [
          el("div", { className: "typing-dots" }, [el("span"), el("span"), el("span")]),
          el("span", { style: { fontSize: 13 } }, [`Building battlecard for ${competitor}…`]),
        ])
      );
      try {
        const res = await fetch("/api/battlecard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ competitor }),
        });
        const data = await res.json();
        clear(resultSlot);
        if (!res.ok) { resultSlot.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, [data.error || "Couldn't build that battlecard."])); return; }
        renderCard(data);
      } catch (e) {
        clear(resultSlot);
        resultSlot.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, ["Couldn't reach the server."]));
      } finally { buildBtn.disabled = false; }
    }

    buildBtn.onclick = build;
    competitorInput.addEventListener("keydown", e => { if (e.key === "Enter") build(); });

    function listCard(title, color, items, bullet) {
      const card = el("div", { className: "card", style: { flex: "1", minWidth: "240px" } }, [
        el("div", { className: "label-eyebrow", style: { marginBottom: "8px", color } }, [title]),
      ]);
      items.forEach(item => card.appendChild(el("div", { style: { display: "flex", gap: "8px", fontSize: "13px", marginBottom: "6px", lineHeight: "1.4" } }, [
        el("span", { style: { color, fontWeight: "700", flex: "0 0 auto" } }, [bullet]),
        el("span", null, [item]),
      ])));
      return card;
    }

    function renderCard(data) {
      resultSlot.appendChild(
        el("div", { className: "card", style: { background: "var(--navy)", color: "#fff", marginBottom: "4px" } }, [
          el("div", { style: { fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.7, marginBottom: "4px" } }, ["vs."]),
          el("div", { style: { fontSize: "22px", fontWeight: "800" } }, [data.competitor]),
          el("div", { style: { fontSize: "13px", opacity: 0.8, marginTop: "8px", fontStyle: "italic" } }, [data.oneLiner]),
        ])
      );
      const row1 = el("div", { style: { display: "flex", gap: "16px", flexWrap: "wrap" } });
      row1.appendChild(listCard("Their strengths", "var(--red)", data.theirStrengths || [], "◆"));
      row1.appendChild(listCard("Our advantages", "var(--green)", data.ourAdvantages || [], "✓"));
      resultSlot.appendChild(row1);

      const trapCard = el("div", { className: "card" }, [el("div", { className: "label-eyebrow", style: { marginBottom: "8px" } }, ["Trap questions"])]);
      (data.trapQuestions || []).forEach((q, i) => {
        trapCard.appendChild(el("div", { style: { display: "flex", gap: "10px", fontSize: "13px", marginBottom: "8px", lineHeight: "1.4" } }, [
          el("span", { style: { fontWeight: "800", color: "var(--indigo)", flex: "0 0 20px" } }, [`${i + 1}.`]),
          el("span", { style: { fontStyle: "italic" } }, [`"${q}"`]),
        ]));
      });
      resultSlot.appendChild(trapCard);

      if (data.objectionHandlers && data.objectionHandlers.length) {
        const objCard = el("div", { className: "card" }, [el("div", { className: "label-eyebrow", style: { marginBottom: "8px" } }, ["Objection handlers"])]);
        data.objectionHandlers.forEach(obj => {
          objCard.appendChild(el("div", { style: { marginBottom: "12px" } }, [
            el("div", { style: { fontSize: "13px", fontWeight: "700", marginBottom: "4px" } }, [`"${obj.objection}"`]),
            el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", paddingLeft: "12px", borderLeft: "2px solid var(--indigo)" } }, [obj.response]),
          ]));
        });
        resultSlot.appendChild(objCard);
      }
    }

    return content;
  }

  renderTopbar();
  renderBody();
  return container;
}

window.ScreenGenerate = { buildGenerateScreen };

})();
