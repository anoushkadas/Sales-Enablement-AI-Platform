(function(){
const { el, iconEl, clear } = window.DOMHelpers;

// A small reusable "pick a deal to anchor this to" control. Shows the
// currently anchored deal (if any) with a "Change" / "Clear" affordance,
// and a dropdown-style picker when no deal is selected or when changing.
// Used by Home (Coach/Learn/Practice/Test/Generate all run through the
// Home conversation engine) as well as anywhere else that wants the
// same picker without duplicating the fetch-and-render logic.
//
// onSelect(deal | null) is called whenever the user picks a deal or
// clears the selection.
function buildDealPicker(currentDeal, onSelect) {
  const container = el("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } });
  let deals = [];
  let pickerOpen = false;

  function render() {
    clear(container);

    if (currentDeal && !pickerOpen) {
      container.appendChild(
        el("div", { className: "pill pill-indigo", style: { display: "inline-flex", alignItems: "center", gap: "6px", alignSelf: "flex-start" } }, [
          iconEl("briefcase", 12, "var(--indigo-deep)", 2),
          `Anchored to ${currentDeal.name}`,
          el("button", {
            style: { background: "none", border: "none", marginLeft: "4px", cursor: "pointer", display: "flex", padding: "0" },
            onclick: (e) => { e.stopPropagation(); pickerOpen = true; loadAndRender(); },
            title: "Change deal",
          }, [iconEl("chevron-down", 12, "var(--indigo-deep)", 2)]),
          el("button", {
            style: { background: "none", border: "none", cursor: "pointer", display: "flex", padding: "0" },
            onclick: (e) => { e.stopPropagation(); currentDeal = null; onSelect(null); render(); },
            title: "Clear deal",
          }, [iconEl("circle-x", 12, "var(--indigo-deep)", 2)]),
        ])
      );
      return;
    }

    const toggleBtn = el("button", {
      className: "pill pill-gray pill-clickable",
      style: { alignSelf: "flex-start" },
      onclick: () => { pickerOpen = !pickerOpen; if (pickerOpen) loadAndRender(); else render(); },
    }, [iconEl("briefcase", 12, "var(--ink-soft)", 2), " Link a deal (optional)"]);
    container.appendChild(toggleBtn);

    if (pickerOpen) {
      const dropdown = el("div", { className: "card", style: { padding: "8px", maxWidth: "320px", maxHeight: "220px", overflowY: "auto" } });
      if (deals.length === 0) {
        dropdown.appendChild(el("div", { style: { fontSize: "12.5px", color: "var(--ink-faint)", padding: "8px" } }, ["No deals yet — add one on the Active Deals screen."]));
      } else {
        deals.forEach(d => {
          dropdown.appendChild(
            el("div", {
              style: { padding: "8px 10px", borderRadius: "8px", cursor: "pointer", fontSize: "13px" },
              onmouseenter: (e) => { e.target.style.background = "var(--line-soft)"; },
              onmouseleave: (e) => { e.target.style.background = "transparent"; },
              onclick: () => { currentDeal = d; pickerOpen = false; onSelect(d); render(); },
            }, [
              el("div", { style: { fontWeight: "700" } }, [d.name]),
              d.company ? el("div", { style: { fontSize: "11.5px", color: "var(--ink-soft)" } }, [d.company]) : null,
            ])
          );
        });
      }
      container.appendChild(dropdown);
    }
  }

  async function loadAndRender() {
    render();
    try {
      const res = await fetch("/api/deals", { credentials: "include" });
      const data = await res.json();
      deals = data.deals || [];
      render();
    } catch (e) {
      deals = [];
      render();
    }
  }

  render();
  return container;
}

window.DealPicker = { buildDealPicker };

})();
