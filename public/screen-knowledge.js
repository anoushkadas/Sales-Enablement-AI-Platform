(function(){
const { el, iconEl, clear } = window.DOMHelpers;
const { buildTopbar, showToast } = window.UIShared;

function buildKnowledgeScreen() {
  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });
  let uploadedThisSession = [];

  container.appendChild(
    buildTopbar("Knowledge", "What the AI is allowed to know about your company")
  );

  const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "18px", maxWidth: "720px" } });

  content.appendChild(
    el("div", { className: "card-flat", style: { background: "var(--indigo-soft)" } }, [
      el("div", { style: { display: "flex", gap: "10px", alignItems: "flex-start" } }, [
        el("div", { style: { width: "24px", height: "24px", borderRadius: "7px", background: "var(--indigo)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 24px" } }, [iconEl("sparkles", 13, "#fff", 2.2)]),
        el("div", { style: { fontSize: "12.5px", lineHeight: "1.5", color: "var(--indigo-deep)" } }, [
          "The AI answers company-specific questions only from what you upload here — pricing sheets, battlecards, product docs, anything. If a question isn't covered by an uploaded document, it will say so instead of guessing.",
        ]),
      ]),
    ])
  );

  const dropZone = el("div", {
    className: "card",
    style: {
      border: "1.5px dashed var(--line)",
      textAlign: "center",
      padding: "36px 24px",
      cursor: "pointer",
    },
  }, [
    iconEl("file-text", 28, "var(--ink-faint)", 1.6),
    el("div", { style: { fontSize: "14.5px", fontWeight: "700", marginTop: "12px" } }, ["Click to choose a file, or drag one here"]),
    el("div", { style: { fontSize: "12px", color: "var(--ink-soft)", marginTop: "4px" } }, ["PDF, DOCX, TXT, Markdown, CSV, and more"]),
  ]);

  const fileInput = el("input", { type: "file", style: { display: "none" } });
  dropZone.appendChild(fileInput);
  dropZone.onclick = () => fileInput.click();
  ["dragover"].forEach(evt => dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.style.borderColor = "var(--indigo)"; }));
  ["dragleave", "drop"].forEach(evt => dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.style.borderColor = "var(--line)"; }));
  dropZone.addEventListener("drop", e => {
    if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) uploadFile(fileInput.files[0]);
  });

  content.appendChild(dropZone);

  const statusBox = el("div");
  content.appendChild(statusBox);

  content.appendChild(el("div", { className: "label-eyebrow" }, ["Uploaded this session"]));
  const listBox = el("div", { className: "card", style: { padding: "0", overflow: "hidden" } }, [
    el("div", { style: { padding: "16px 18px", fontSize: "13px", color: "var(--ink-faint)" } }, ["Nothing uploaded yet in this session."]),
  ]);
  content.appendChild(listBox);

  function renderList() {
    clear(listBox);
    if (uploadedThisSession.length === 0) {
      listBox.appendChild(el("div", { style: { padding: "16px 18px", fontSize: "13px", color: "var(--ink-faint)" } }, ["Nothing uploaded yet in this session."]));
      return;
    }
    uploadedThisSession.forEach((name, i) => {
      if (i > 0) listBox.appendChild(el("div", { className: "divider" }));
      listBox.appendChild(
        el("div", { className: "row", style: { padding: "12px 18px" } }, [
          el("div", { style: { display: "flex", alignItems: "center", gap: "10px" } }, [
            iconEl("circle-check", 16, "var(--assess)", 2.2),
            el("span", { style: { fontSize: "13px", fontWeight: "600" } }, [name]),
          ]),
        ])
      );
    });
  }

  async function uploadFile(file) {
    clear(statusBox);
    statusBox.appendChild(
      el("div", { className: "card-flat", style: { display: "flex", gap: "10px", alignItems: "center" } }, [
        el("div", { className: "typing-dots" }, [el("span"), el("span"), el("span")]),
        el("span", { style: { fontSize: "13px" } }, [`Uploading and indexing "${file.name}"…`]),
      ])
    );

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/knowledge/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json();
      clear(statusBox);
      if (!res.ok) {
        statusBox.appendChild(
          el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: "13px" } }, [data.error || "Upload failed."])
        );
        return;
      }
      uploadedThisSession.unshift(data.displayName || file.name);
      renderList();
      if (data.note) {
        showToast(data.note);
      } else {
        showToast(`"${file.name}" indexed and ready to be searched`);
      }
    } catch (e) {
      clear(statusBox);
      statusBox.appendChild(
        el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: "13px" } }, ["Couldn't reach the server. Try again."])
      );
    }
  }

  container.appendChild(content);
  return container;
}

window.ScreenKnowledge = { buildKnowledgeScreen };

})();
