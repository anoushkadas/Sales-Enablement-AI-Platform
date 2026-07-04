(function(){
const { el, iconEl, clear } = window.DOMHelpers;
const { buildTopbar, showToast } = window.UIShared;

function buildBattlecardScreen() {
  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });
  container.appendChild(buildTopbar("Battlecards", "On-demand competitor one-pagers grounded in your knowledge base"));

  const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "720px" } });
  container.appendChild(content);

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
      if (!res.ok) {
        resultSlot.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, [data.error || "Couldn't build that battlecard."]));
        return;
      }
      renderCard(data);
    } catch (e) {
      clear(resultSlot);
      resultSlot.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, ["Couldn't reach the server."]));
    } finally {
      buildBtn.disabled = false;
    }
  }

  buildBtn.onclick = build;
  competitorInput.addEventListener("keydown", e => { if (e.key === "Enter") build(); });

  function listCard(title, color, items, bullet) {
    const card = el("div", { className: "card", style: { flex: "1", minWidth: "240px" } }, [
      el("div", { className: "label-eyebrow", style: { marginBottom: "8px", color } }, [title]),
    ]);
    items.forEach(item => {
      card.appendChild(el("div", { style: { display: "flex", gap: "8px", fontSize: "13px", marginBottom: "6px", lineHeight: "1.4" } }, [
        el("span", { style: { color, fontWeight: "700", flex: "0 0 auto" } }, [bullet]),
        el("span", null, [item]),
      ]));
    });
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

    const trapCard = el("div", { className: "card" }, [
      el("div", { className: "label-eyebrow", style: { marginBottom: "8px" } }, ["Trap questions to ask"]),
    ]);
    (data.trapQuestions || []).forEach((q, i) => {
      trapCard.appendChild(el("div", { style: { display: "flex", gap: "10px", fontSize: "13px", marginBottom: "8px", lineHeight: "1.4" } }, [
        el("span", { style: { fontWeight: "800", color: "var(--indigo)", flex: "0 0 20px" } }, [`${i + 1}.`]),
        el("span", { style: { fontStyle: "italic" } }, [`"${q}"`]),
      ]));
    });
    resultSlot.appendChild(trapCard);

    if (data.objectionHandlers && data.objectionHandlers.length) {
      const objCard = el("div", { className: "card" }, [
        el("div", { className: "label-eyebrow", style: { marginBottom: "8px" } }, ["Objection handlers"]),
      ]);
      data.objectionHandlers.forEach(obj => {
        objCard.appendChild(el("div", { style: { marginBottom: "12px" } }, [
          el("div", { style: { fontSize: "13px", fontWeight: "700", marginBottom: "4px" } }, [`"${obj.objection}"`]),
          el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", paddingLeft: "12px", borderLeft: "2px solid var(--indigo)" } }, [obj.response]),
        ]));
      });
      resultSlot.appendChild(objCard);
    }
  }

  return container;
}

window.ScreenBattlecard = { buildBattlecardScreen };

})();
