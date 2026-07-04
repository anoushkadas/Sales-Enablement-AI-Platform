(function(){
const { el, iconEl, clear } = window.DOMHelpers;
const { buildTopbar, showToast } = window.UIShared;

const TAG_CLASS = {
  General: "pill-gray",
  Deal: "pill-indigo",
  Pricing: "pill-gray",
  Competitors: "pill-practice",
  Product: "pill-gray",
  Objections: "pill-practice",
};

function tagClassFor(tag) {
  return TAG_CLASS[tag] || "pill-gray";
}

function formatWhen(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Asked today, ${time}`;
  if (isYesterday) return `Asked yesterday, ${time}`;
  return `Asked ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

function buildHistoryScreen() {
  let allItems = [];
  let query = "";
  let filter = "All";
  let tags = ["All"];
  let activeView = "lookups"; // 'lookups' | 'generated'

  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });
  const topbarSlot = el("div");
  container.appendChild(topbarSlot);

  function renderTopbar() {
    clear(topbarSlot);
    topbarSlot.appendChild(
      buildTopbar(
        activeView === "lookups" ? "History & lookups" : "Generated content",
        activeView === "lookups"
          ? "Every answer you've gotten, searchable in seconds"
          : "Every PPT and proposal you've generated, in one library",
        [
          el("div", { style: { display: "flex", gap: "6px" } }, [
            el("button", {
              className: `pill pill-clickable ${activeView === "lookups" ? "pill-navy" : "pill-gray"}`,
              onclick: () => { activeView = "lookups"; renderTopbar(); renderBody(); },
            }, [iconEl("clock", 12, activeView === "lookups" ? "#fff" : "var(--ink-soft)", 2), " Lookups"]),
            el("button", {
              className: `pill pill-clickable ${activeView === "generated" ? "pill-navy" : "pill-gray"}`,
              onclick: () => { activeView = "generated"; renderTopbar(); renderBody(); },
            }, [iconEl("layers", 12, activeView === "generated" ? "#fff" : "var(--ink-soft)", 2), " Generated content"]),
          ]),
        ]
      )
    );
  }

  const bodySlot = el("div", { style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column" } });
  container.appendChild(bodySlot);

  function renderBody() {
    clear(bodySlot);
    if (activeView === "lookups") {
      bodySlot.appendChild(buildLookupsView());
    } else {
      bodySlot.appendChild(buildGeneratedContentView());
    }
  }

  // ---------------------------------------------------------------------
  // Lookups view (original History & lookups screen)
  // ---------------------------------------------------------------------
  function buildLookupsView() {
    const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "16px" } });

    const searchInput = el("input", {
      placeholder: "Search your past questions and answers…",
      oninput: e => { query = e.target.value; renderList(); },
    });

    // ---------- Save-search button ----------
    const saveSearchBtn = el("button", {
      className: "btn btn-secondary btn-sm",
      title: "Save this search",
      onclick: async () => {
        const q = searchInput.value.trim();
        const name = prompt("Name this saved search:", q || "My search");
        if (!name) return;
        try {
          const res = await fetch("/api/saved-searches", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ name, query: q, tagFilter: filter }),
          });
          const data = await res.json();
          if (!res.ok) { showToast(data.error || "Couldn't save that search."); return; }
          showToast("Search saved");
          loadSavedSearches();
        } catch (e) { showToast("Couldn't reach the server."); }
      },
    }, [iconEl("star", 12, "var(--ink)", 2), " Save"]);

    content.appendChild(
      el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, [
        el("div", { className: "ask-bar", style: { flex: "1" } }, [
          iconEl("search", 18, "var(--ink-faint)", 2),
          searchInput,
          el("span", { className: "pill pill-gray" }, ["\u2318K"]),
        ]),
        saveSearchBtn,
      ])
    );

    // ---------- Saved searches ----------
    const savedSearchesSlot = el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } });
    content.appendChild(savedSearchesSlot);

    async function loadSavedSearches() {
      clear(savedSearchesSlot);
      try {
        const res = await fetch("/api/saved-searches", { credentials: "include" });
        const data = await res.json();
        (data.searches || []).forEach(s => {
          const chip = el("div", { style: { display: "flex", alignItems: "center", gap: "0" } }, [
            el("button", {
              className: "pill pill-gray pill-clickable",
              style: { borderRadius: "100px 0 0 100px", paddingRight: "8px" },
              onclick: () => {
                searchInput.value = s.query;
                query = s.query;
                filter = s.tag_filter;
                renderFilters();
                renderList();
              },
            }, [iconEl("search", 11, "var(--ink-soft)", 2), ` ${s.name}`]),
            el("button", {
              className: "pill pill-gray pill-clickable",
              style: { borderRadius: "0 100px 100px 0", paddingLeft: "6px", paddingRight: "8px", borderLeft: "1px solid var(--line-soft)" },
              title: "Delete this saved search",
              onclick: async () => {
                await fetch(`/api/saved-searches/${s.id}`, { method: "DELETE", credentials: "include" });
                loadSavedSearches();
              },
            }, ["×"]),
          ]);
          savedSearchesSlot.appendChild(chip);
        });
      } catch (e) {}
    }
    loadSavedSearches();

    const filterRow = el("div", { style: { display: "flex", gap: "8px" } });
    function renderFilters() {
      clear(filterRow);
      tags.forEach(t => {
        filterRow.appendChild(
          el("button", {
            className: `pill pill-clickable ${filter === t ? "pill-navy" : "pill-gray"}`,
            style: { padding: "7px 14px" },
            onclick: () => { filter = t; renderFilters(); renderList(); },
          }, [t])
        );
      });
    }
    renderFilters();
    content.appendChild(filterRow);

    content.appendChild(
      el("div", { className: "card-flat", style: { background: "var(--indigo-soft)" } }, [
        el("div", { style: { display: "flex", gap: "10px", alignItems: "center" } }, [
          iconEl("clock", 16, "var(--indigo-deep)", 2),
          el("div", { style: { fontSize: "12.5px", color: "var(--indigo-deep)" } }, ["Mid-call? Search here instead of re-asking — most answers surface in under 2 seconds."]),
        ]),
      ])
    );

    const listWrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
    content.appendChild(listWrap);

    async function loadHistory() {
      clear(listWrap);
      listWrap.appendChild(el("div", { style: { fontSize: 13, color: "var(--ink-faint)" } }, ["Loading…"]));
      try {
        const res = await fetch("/api/history", { credentials: "include" });
        const data = await res.json();
        allItems = data.items || [];
        const uniqueTags = Array.from(new Set(allItems.map(i => i.tag)));
        tags = ["All", ...uniqueTags];
        renderFilters();
        renderList();
      } catch (e) {
        clear(listWrap);
        listWrap.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, ["Couldn't load your history."]));
      }
    }

    function renderList() {
      clear(listWrap);
      const q = query.trim().toLowerCase();
      const filtered = allItems.filter(h => {
        const matchesFilter = filter === "All" || h.tag === filter;
        const matchesQuery = !q || h.question.toLowerCase().includes(q) || h.answer.toLowerCase().includes(q);
        return matchesFilter && matchesQuery;
      });

      if (filtered.length === 0) {
        const message = allItems.length === 0
          ? "No history yet — every question you ask across Learn, Practice, Coach, and Test will be saved here automatically."
          : "No matches. Try a different search term or filter.";
        listWrap.appendChild(el("div", { style: { padding: "32px 0", textAlign: "center", color: "var(--ink-faint)", fontSize: "13.5px" } }, [message]));
        return;
      }

      filtered.forEach(h => {
        listWrap.appendChild(
          el("div", { className: "card", style: { padding: "16px 18px" } }, [
            el("div", { className: "row", style: { marginBottom: "8px" } }, [
              el("span", { style: { fontSize: "13px", fontWeight: "700" } }, [`"${h.question}"`]),
              el("span", { style: { fontSize: "11.5px", color: "var(--ink-faint)" } }, [formatWhen(h.created_at)]),
            ]),
            el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", lineHeight: "1.5" } }, [h.answer]),
            el("div", { className: "row", style: { marginTop: "10px" } }, [
              el("span", { className: `pill ${tagClassFor(h.tag)}` }, [h.tag]),
              el("div", { style: { display: "flex", gap: "6px" } }, [
                el("button", {
                  className: "pill pill-gray pill-clickable",
                  onclick: () => { navigator.clipboard && navigator.clipboard.writeText(h.answer); showToast("Copied to clipboard"); },
                }, [iconEl("copy", 12, "var(--ink-soft)", 2), " Copy"]),
              ]),
            ]),
          ])
        );
      });
    }

    loadHistory();
    return content;
  }

  // ---------------------------------------------------------------------
  // Generated content view — two columns: PPTs on the left, DOCXs (Word
  // proposals) on the right.
  // ---------------------------------------------------------------------
  function formatGeneratedDate(isoString) {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function buildGeneratedCard(item) {
    return el("div", { className: "card", style: { display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px" } }, [
      el("div", {
        style: {
          width: "38px", height: "38px", borderRadius: "10px", flex: "0 0 38px",
          background: item.file_type === "pptx" ? "var(--indigo-soft)" : "var(--sage-bg)",
          display: "flex", alignItems: "center", justifyContent: "center",
        },
      }, [iconEl(item.file_type === "pptx" ? "layers" : "file-text", 18, item.file_type === "pptx" ? "var(--indigo-deep)" : "var(--sage-deep)")]),
      el("div", { style: { flex: "1", minWidth: "0" } }, [
        el("div", { style: { fontSize: "13.5px", fontWeight: "700", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, [item.title]),
        el("div", { style: { fontSize: "11.5px", color: "var(--ink-faint)", marginTop: "2px" } }, [formatGeneratedDate(item.created_at)]),
      ]),
      el("button", {
        className: "icon-btn",
        title: "Download",
        onclick: () => { window.location.href = `/api/generated-content/${item.id}/download`; },
      }, [iconEl("download", 16, "var(--ink)", 2)]),
    ]);
  }

  function buildGeneratedColumn(title, icon, items, emptyText) {
    const col = el("div", { style: { flex: "1", display: "flex", flexDirection: "column", gap: "10px", minWidth: "0" } });
    col.appendChild(
      el("div", { className: "row" }, [
        el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [
          iconEl(icon, 16, "var(--ink-soft)", 2),
          el("div", { className: "label-eyebrow" }, [title]),
        ]),
        el("span", { className: "pill pill-gray" }, [String(items.length)]),
      ])
    );
    if (items.length === 0) {
      col.appendChild(
        el("div", { className: "card", style: { textAlign: "center", padding: "28px 16px" } }, [
          el("div", { style: { fontSize: "12.5px", color: "var(--ink-faint)" } }, [emptyText]),
        ])
      );
    } else {
      items.forEach(item => col.appendChild(buildGeneratedCard(item)));
    }
    return col;
  }

  function buildGeneratedContentView() {
    const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "16px" } });
    const bodyWrap = el("div", { style: { display: "flex", gap: "20px" } });
    content.appendChild(bodyWrap);

    bodyWrap.appendChild(el("div", { style: { fontSize: 13, color: "var(--ink-faint)" } }, ["Loading…"]));

    (async () => {
      try {
        const res = await fetch("/api/generated-content", { credentials: "include" });
        const data = await res.json();
        const items = data.items || [];
        const pptItems = items.filter(i => i.file_type === "pptx");
        const docItems = items.filter(i => i.file_type === "docx");

        clear(bodyWrap);
        bodyWrap.appendChild(buildGeneratedColumn("Presentations (PPT)", "layers", pptItems, "No presentations generated yet — create one from the Generate tab."));
        bodyWrap.appendChild(el("div", { style: { width: "0.5px", background: "var(--line)" } }));
        bodyWrap.appendChild(buildGeneratedColumn("Proposals (Word)", "file-text", docItems, "No proposals generated yet — create one from the Generate tab."));
      } catch (e) {
        clear(bodyWrap);
        bodyWrap.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, ["Couldn't load generated content."]));
      }
    })();

    return content;
  }

  renderTopbar();
  renderBody();

  return container;
}

window.ScreenHistory = { buildHistoryScreen };

})();
