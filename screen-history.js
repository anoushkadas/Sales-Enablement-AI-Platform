(function(){
const { el, iconEl, clear } = window.DOMHelpers;
const { buildTopbar, showToast } = window.UIShared;

function buildHistoryScreen() {
  const LOG = window.APP_DATA.HISTORY_LOG;
  const tags = ["All", "Pricing", "Competitors", "Product", "Objections"];
  let query = "";
  let filter = "All";

  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });
  container.appendChild(buildTopbar("History & lookups", "Every answer you've gotten, searchable in seconds"));

  const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "16px" } });

  const searchInput = el("input", {
    placeholder: "Search your past questions and answers…",
    oninput: e => { query = e.target.value; renderList(); },
  });
  content.appendChild(
    el("div", { className: "ask-bar" }, [
      iconEl("search", 18, "var(--ink-faint)", 2),
      searchInput,
      el("span", { className: "pill pill-gray" }, ["\u2318K"]),
    ])
  );

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

  function renderList() {
    clear(listWrap);
    const q = query.trim().toLowerCase();
    const filtered = LOG.filter(h => {
      const matchesFilter = filter === "All" || h.tag === filter;
      const matchesQuery = !q || h.q.toLowerCase().includes(q) || h.a.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });

    if (filtered.length === 0) {
      const message = LOG.length === 0
        ? "No history yet — every question you ask across Learn, Practice, Coach, and Test will be saved here automatically."
        : "No matches. Try a different search term or filter.";
      listWrap.appendChild(el("div", { style: { padding: "32px 0", textAlign: "center", color: "var(--ink-faint)", fontSize: "13.5px" } }, [message]));
      return;
    }

    filtered.forEach(h => {
      listWrap.appendChild(
        el("div", { className: "card", style: { padding: "16px 18px" } }, [
          el("div", { className: "row", style: { marginBottom: "8px" } }, [
            el("span", { style: { fontSize: "13px", fontWeight: "700" } }, [`"${h.q}"`]),
            el("span", { style: { fontSize: "11.5px", color: "var(--ink-faint)" } }, [h.when]),
          ]),
          el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", lineHeight: "1.5" } }, [h.a]),
          el("div", { className: "row", style: { marginTop: "10px" } }, [
            el("span", { className: `pill ${h.tagClass}` }, [h.tag]),
            el("div", { style: { display: "flex", gap: "6px" } }, [
              el("button", {
                className: "pill pill-gray pill-clickable",
                onclick: () => { navigator.clipboard && navigator.clipboard.writeText(h.a); showToast("Copied to clipboard"); },
              }, [iconEl("copy", 12, "var(--ink-soft)", 2), " Copy"]),
              el("button", {
                className: "pill pill-indigo pill-clickable",
                onclick: () => showToast("Reopen placeholder — wire this to load the full saved conversation"),
              }, [iconEl("arrow-right", 12, "var(--indigo-deep)", 2), " Reopen"]),
            ]),
          ]),
        ])
      );
    });
  }
  renderList();

  container.appendChild(content);
  return container;
}

window.ScreenHistory = { buildHistoryScreen };

})();
