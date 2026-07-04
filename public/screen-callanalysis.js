(function(){
const { el, iconEl, clear } = window.DOMHelpers;
const { buildTopbar, showToast } = window.UIShared;

function buildCallAnalysisScreen() {
  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });
  container.appendChild(buildTopbar("Call analysis", "Paste a transcript or upload a recording — get a scored breakdown of how you performed"));

  const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "720px" } });
  container.appendChild(content);

  content.appendChild(
    el("div", { className: "card-flat", style: { background: "var(--indigo-soft)" } }, [
      el("div", { style: { fontSize: "12.5px", lineHeight: "1.5", color: "var(--indigo-deep)" } }, [
        "Paste your call transcript below, or upload a text/Word file. The coach will score your performance, identify every objection and how you handled it, and tell you exactly what to practice before your next call.",
      ]),
    ])
  );

  const transcriptInput = el("textarea", {
    placeholder: "Paste your call transcript here…\n\nRep: Thanks for taking the time today. I wanted to walk you through...\nProspect: Sure, though I'll be honest, we already have a vendor we're pretty happy with.",
    style: { border: "1px solid var(--line)", borderRadius: "10px", padding: "12px 14px", fontSize: "13px", minHeight: "180px", fontFamily: "inherit", resize: "vertical" },
  });
  content.appendChild(el("div", { className: "label-eyebrow" }, ["Paste transcript"]));
  content.appendChild(transcriptInput);

  content.appendChild(el("div", { className: "label-eyebrow" }, ["Or upload a file (.txt or .docx)"]));
  const fileInput = el("input", { type: "file", accept: ".txt,.docx,text/plain" });
  content.appendChild(fileInput);

  const analyzeBtn = el("button", { className: "btn btn-primary" }, [iconEl("sparkles", 14, "#fff", 2), " Analyze call"]);
  content.appendChild(analyzeBtn);

  const resultSlot = el("div");
  content.appendChild(resultSlot);

  analyzeBtn.onclick = async () => {
    const transcript = transcriptInput.value.trim();
    const file = fileInput.files && fileInput.files[0];
    if (!transcript && !file) { showToast("Paste a transcript or upload a file first."); return; }

    clear(resultSlot);
    analyzeBtn.disabled = true;
    resultSlot.appendChild(
      el("div", { className: "card-flat", style: { display: "flex", gap: 10, alignItems: "center" } }, [
        el("div", { className: "typing-dots" }, [el("span"), el("span"), el("span")]),
        el("span", { style: { fontSize: 13 } }, ["Analyzing your call…"]),
      ])
    );

    try {
      const formData = new FormData();
      if (transcript) formData.append("transcript", transcript);
      if (file) formData.append("file", file);

      const res = await fetch("/api/call-analysis", { method: "POST", credentials: "include", body: formData });
      const data = await res.json();
      clear(resultSlot);
      if (!res.ok) {
        resultSlot.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, [data.error || "Couldn't analyze that."]));
        return;
      }
      renderResult(data);
    } catch (e) {
      clear(resultSlot);
      resultSlot.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, ["Couldn't reach the server."]));
    } finally {
      analyzeBtn.disabled = false;
    }
  };

  function renderResult(data) {
    const scoreColor = data.overallScore >= 8 ? "var(--green)" : data.overallScore >= 5 ? "var(--amber)" : "var(--red)";

    resultSlot.appendChild(
      el("div", { className: "card", style: { display: "flex", alignItems: "center", gap: "20px", padding: "20px 24px" } }, [
        el("div", { style: { textAlign: "center", flex: "0 0 auto" } }, [
          el("div", { style: { fontSize: "42px", fontWeight: "800", color: scoreColor, lineHeight: 1 } }, [`${data.overallScore}`]),
          el("div", { style: { fontSize: "11px", color: "var(--ink-faint)", marginTop: "4px" } }, ["out of 10"]),
        ]),
        el("div", { style: { flex: "1" } }, [
          el("div", { style: { fontSize: "13.5px", lineHeight: "1.5" } }, [data.summary]),
        ]),
      ])
    );

    if (data.objections && data.objections.length) {
      resultSlot.appendChild(el("div", { className: "label-eyebrow", style: { marginTop: "16px" } }, ["Objections & how you handled them"]));
      data.objections.forEach(obj => {
        const qualityColor = obj.quality === "strong" ? "var(--green)" : obj.quality === "ok" ? "var(--amber)" : "var(--red)";
        const qualityBg = obj.quality === "strong" ? "var(--green-bg)" : obj.quality === "ok" ? "var(--amber-bg)" : "var(--red-bg)";
        resultSlot.appendChild(
          el("div", { className: "card", style: { borderLeft: `3px solid ${qualityColor}` } }, [
            el("div", { className: "row", style: { marginBottom: "8px" } }, [
              el("div", { style: { fontSize: "13.5px", fontWeight: "700" } }, [`"${obj.objection}"`]),
              el("span", { className: "pill", style: { background: qualityBg, color: qualityColor } }, [obj.quality]),
            ]),
            el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", marginBottom: "8px" } }, [`How you handled it: ${obj.howHandled}`]),
            el("div", { className: "card-flat", style: { fontSize: "12.5px", color: "var(--indigo-deep)", background: "var(--indigo-soft)" } }, [
              el("strong", null, ["Better response: "]), obj.betterResponse,
            ]),
          ])
        );
      });
    }

    const twoCol = el("div", { style: { display: "flex", gap: "16px", flexWrap: "wrap" } });

    const strengthsCard = el("div", { className: "card", style: { flex: "1", minWidth: "240px" } }, [
      el("div", { className: "label-eyebrow", style: { marginBottom: "8px" } }, ["What you did well"]),
    ]);
    (data.strengths || []).forEach(s => {
      strengthsCard.appendChild(el("div", { style: { display: "flex", gap: "8px", fontSize: "13px", marginBottom: "6px" } }, [
        el("span", { style: { color: "var(--green)", fontWeight: "700", flex: "0 0 auto" } }, ["✓"]),
        el("span", null, [s]),
      ]));
    });
    twoCol.appendChild(strengthsCard);

    const improvCard = el("div", { className: "card", style: { flex: "1", minWidth: "240px" } }, [
      el("div", { className: "label-eyebrow", style: { marginBottom: "8px" } }, ["What to improve"]),
    ]);
    (data.improvements || []).forEach(s => {
      improvCard.appendChild(el("div", { style: { display: "flex", gap: "8px", fontSize: "13px", marginBottom: "6px" } }, [
        el("span", { style: { color: "var(--red)", fontWeight: "700", flex: "0 0 auto" } }, ["→"]),
        el("span", null, [s]),
      ]));
    });
    twoCol.appendChild(improvCard);
    resultSlot.appendChild(twoCol);

    resultSlot.appendChild(
      el("div", { className: "card", style: { background: "var(--navy)", color: "#fff" } }, [
        el("div", { style: { fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.7, marginBottom: "6px" } }, ["Top practice area"]),
        el("div", { style: { fontSize: "14px", fontWeight: "700" } }, [data.topPracticeArea]),
      ])
    );
  }

  return container;
}

window.ScreenCallAnalysis = { buildCallAnalysisScreen };

})();
