(function(){
const { el, iconEl } = window.DOMHelpers;
const { buildTopbar } = window.UIShared;

function emptyState(icon, title, body) {
  return el("div", { className: "card", style: { textAlign: "center", padding: "32px 24px" } }, [
    iconEl(icon, 28, "var(--ink-faint)", 1.6),
    el("div", { style: { fontSize: "15px", fontWeight: "700", marginTop: "12px" } }, [title]),
    el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", marginTop: "6px", lineHeight: "1.5", maxWidth: "360px", margin: "6px auto 0" } }, [body]),
  ]);
}

function buildRoadmapScreen() {
  const PAST = window.APP_DATA.PAST_LESSONS;
  const FUTURE = window.APP_DATA.FUTURE_LESSONS;

  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });
  container.appendChild(buildTopbar("Learning roadmap", "Your structured upskilling path"));

  const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "18px" } });

  if (PAST.length === 0 && FUTURE.length === 0) {
    content.appendChild(
      emptyState(
        "map",
        "No learning roadmap yet",
        "This screen will fill in once lessons exist for your team. For now, use Learn mode on the Home screen to study any topic directly with the AI."
      )
    );
    container.appendChild(content);
    return container;
  }

  const split = el("div", { style: { display: "flex", gap: "20px" } });

  const pastCol = el("div", { style: { flex: "1", display: "flex", flexDirection: "column", gap: "12px" } }, [
    el("div", { className: "row" }, [
      el("div", { className: "label-eyebrow" }, ["Past lessons"]),
      el("span", { className: "pill pill-gray" }, [`${PAST.length} completed`]),
    ]),
  ]);
  if (PAST.length === 0) {
    pastCol.appendChild(emptyState("circle-check", "Nothing completed yet", "Completed lessons will show up here."));
  } else {
    PAST.forEach(l => {
      pastCol.appendChild(
        el("div", { className: "card", style: { display: "flex", gap: "12px", alignItems: "center" } }, [
          el("div", { style: { width: "32px", height: "32px", borderRadius: "50%", background: "var(--assess)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 32px" } }, [iconEl("circle-check", 16, "#fff", 2.4)]),
          el("div", { style: { flex: "1" } }, [
            el("div", { style: { fontSize: "13.5px", fontWeight: "600" } }, [l.title]),
            el("div", { style: { fontSize: "11.5px", color: "var(--ink-soft)" } }, [`${l.date} · scored ${l.score}%`]),
          ]),
          el("span", { className: `pill ${l.tagClass}` }, [l.tag]),
        ])
      );
    });
  }

  const futureCol = el("div", { style: { flex: "1", display: "flex", flexDirection: "column", gap: "12px" } }, [
    el("div", { className: "row" }, [
      el("div", { className: "label-eyebrow" }, ["Future lessons"]),
      el("span", { className: "pill pill-gray" }, [`${FUTURE.length} remaining`]),
    ]),
  ]);
  if (FUTURE.length === 0) {
    futureCol.appendChild(emptyState("map", "Nothing queued up", "Upcoming lessons will show up here."));
  } else {
    FUTURE.forEach(l => {
      let markerChild = null;
      if (l.state === "next") markerChild = iconEl("player-play", 14, "var(--practice-deep)", 2.2);
      else if (l.state === "locked") markerChild = iconEl("lock", 14, "var(--ink-faint)", 2);

      futureCol.appendChild(
        el("div", {
          className: "card",
          style: {
            display: "flex", gap: "12px", alignItems: "center",
            border: l.state === "next" ? "1.5px solid var(--practice)" : "0.5px solid var(--line)",
            opacity: l.state === "locked" ? "0.6" : "1",
          },
        }, [
          el("div", {
            style: {
              width: "32px", height: "32px", borderRadius: "50%", flex: "0 0 32px",
              background: l.state === "next" ? "var(--practice-bg)" : "transparent",
              border: l.state === "next" ? "1.5px solid var(--practice)" : "1.5px solid var(--line)",
              display: "flex", alignItems: "center", justifyContent: "center",
            },
          }, [markerChild]),
          el("div", { style: { flex: "1" } }, [
            el("div", { style: { fontSize: "13.5px", fontWeight: l.state === "next" ? "700" : "600", color: l.state === "locked" ? "var(--ink-soft)" : "var(--ink)" } }, [l.title]),
            el("div", { style: { fontSize: "11.5px", color: "var(--ink-soft)" } }, [l.note]),
          ]),
          el("span", { className: `pill ${l.tagClass}` }, [l.tag]),
        ])
      );
    });
  }

  split.appendChild(pastCol);
  split.appendChild(el("div", { style: { width: "0.5px", background: "var(--line)" } }));
  split.appendChild(futureCol);
  content.appendChild(split);
  container.appendChild(content);

  return container;
}

window.ScreenRoadmap = { buildRoadmapScreen };

})();
