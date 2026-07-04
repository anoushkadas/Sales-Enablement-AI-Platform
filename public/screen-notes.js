(function(){
const { el, iconEl, clear } = window.DOMHelpers;
const { buildTopbar, showToast } = window.UIShared;

function formatNoteDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + `, ${time}`;
}

function buildNotesScreen() {
  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });
  container.appendChild(buildTopbar("Notes", "Everything you've jotted down while studying, in one place"));

  const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "14px" } });
  container.appendChild(content);

  const listSlot = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
  content.appendChild(listSlot);

  async function loadNotes() {
    clear(listSlot);
    listSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--ink-faint)" } }, ["Loading…"]));
    try {
      const res = await fetch("/api/notes", { credentials: "include" });
      const data = await res.json();
      renderNotes(data.notes || []);
    } catch (e) {
      clear(listSlot);
      listSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, ["Couldn't load your notes."]));
    }
  }

  function renderNotes(notes) {
    clear(listSlot);
    if (notes.length === 0) {
      listSlot.appendChild(
        el("div", { className: "card", style: { textAlign: "center", padding: "32px 24px" } }, [
          iconEl("list", 28, "var(--ink-faint)", 1.6),
          el("div", { style: { fontSize: "15px", fontWeight: "700", marginTop: "12px" } }, ["No notes yet"]),
          el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", marginTop: "6px", lineHeight: "1.5", maxWidth: "360px", margin: "6px auto 0" } }, [
            "Open a saved lesson on the Learning Roadmap screen, expand it, and jot a note — it'll show up here tagged with the topic it came from.",
          ]),
        ])
      );
      return;
    }

    notes.forEach(note => {
      listSlot.appendChild(
        el("div", { className: "card", style: { padding: "16px 18px" } }, [
          el("div", { className: "row", style: { marginBottom: "8px" } }, [
            el("span", { className: "pill pill-indigo" }, [note.topic]),
            el("span", { style: { fontSize: "11.5px", color: "var(--ink-faint)" } }, [formatNoteDate(note.created_at)]),
          ]),
          el("div", { style: { fontSize: "13.5px", lineHeight: "1.5", whiteSpace: "pre-wrap" } }, [note.note_text]),
          el("div", { className: "row", style: { marginTop: "10px" } }, [
            el("span"),
            el("div", { style: { display: "flex", gap: "6px" } }, [
              el("button", {
                className: "pill pill-gray pill-clickable",
                onclick: () => { navigator.clipboard && navigator.clipboard.writeText(note.note_text); showToast("Copied to clipboard"); },
              }, [iconEl("copy", 12, "var(--ink-soft)", 2), " Copy"]),
              el("button", {
                className: "pill pill-gray pill-clickable",
                onclick: () => deleteNote(note.id),
              }, [iconEl("circle-x", 12, "var(--red)", 2), " Delete"]),
            ]),
          ]),
        ])
      );
    });
  }

  async function deleteNote(id) {
    if (!confirm("Delete this note?")) return;
    try {
      await fetch(`/api/notes/${id}`, { method: "DELETE", credentials: "include" });
      loadNotes();
    } catch (e) {
      showToast("Couldn't delete that note.");
    }
  }

  loadNotes();
  return container;
}

window.ScreenNotes = { buildNotesScreen };

})();
