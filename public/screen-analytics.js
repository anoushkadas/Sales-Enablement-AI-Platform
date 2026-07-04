(function(){
const { el, iconEl } = window.DOMHelpers;
const { buildTopbar } = window.UIShared;

function svgEl(tag, attrs, children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.keys(attrs || {}).forEach(k => node.setAttribute(k, attrs[k]));
  (children || []).forEach(c => c && node.appendChild(c));
  return node;
}

function buildDonutChart(segments, size) {
  size = size || 220;
  const cx = size / 2, cy = size / 2, r = size / 2 - 18, stroke = 26;
  const total = segments.reduce((a, s) => a + s.value, 0);
  const svg = svgEl("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": "Course completion breakdown" });

  if (total === 0) {
    svg.appendChild(svgEl("circle", { cx, cy, r, fill: "none", stroke: "#F0EEE7", "stroke-width": stroke }));
    return svg;
  }

  let angle = -90;
  const circ = 2 * Math.PI * r;
  segments.forEach(s => {
    if (s.value === 0) return;
    const frac = s.value / total;
    const len = frac * circ;
    const gap = segments.filter(x => x.value > 0).length > 1 ? 3 : 0;
    const dasharray = `${Math.max(len - gap, 0).toFixed(1)} ${(circ - len + gap).toFixed(1)}`;
    const rotate = angle;
    angle += frac * 360;
    svg.appendChild(svgEl("circle", {
      cx, cy, r, fill: "none", stroke: s.color, "stroke-width": stroke,
      "stroke-dasharray": dasharray, "stroke-linecap": gap ? "round" : "butt",
      transform: `rotate(${rotate} ${cx} ${cy})`,
    }));
  });

  const totalText = svgEl("text", { x: cx, y: cy - 4, "font-size": 28, "font-weight": 700, fill: "#21262E", "text-anchor": "middle" });
  totalText.textContent = String(total);
  const labelText = svgEl("text", { x: cx, y: cy + 18, "font-size": 11.5, fill: "#9A9FAC", "text-anchor": "middle" });
  labelText.textContent = total === 1 ? "course" : "courses";
  svg.appendChild(totalText);
  svg.appendChild(labelText);

  return svg;
}

function buildAnalyticsScreen() {
  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });
  container.appendChild(buildTopbar("My analytics", "Where your learning roadmap stands right now"));

  const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "18px" } });
  container.appendChild(content);

  const bodySlot = el("div");
  content.appendChild(bodySlot);

  async function load() {
    window.DOMHelpers.clear(bodySlot);
    bodySlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--ink-faint)" } }, ["Loading…"]));
    try {
      const res = await fetch("/api/analytics", { credentials: "include" });
      const data = await res.json();
      window.DOMHelpers.clear(bodySlot);
      renderBody(data.counts || { not_started: 0, in_progress: 0, done: 0, overdue: 0 });
    } catch (e) {
      window.DOMHelpers.clear(bodySlot);
      bodySlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, ["Couldn't load your analytics."]));
    }
  }

  function renderBody(counts) {
    const total = counts.not_started + counts.in_progress + counts.done;
    const overdueCount = counts.overdue || 0;

    if (total === 0) {
      bodySlot.appendChild(
        el("div", { className: "card", style: { textAlign: "center", padding: "40px 24px", maxWidth: "440px", margin: "20px auto" } }, [
          iconEl("chart-bar", 28, "var(--ink-faint)", 1.6),
          el("div", { style: { fontSize: "15px", fontWeight: "700", marginTop: "12px" } }, ["Nothing on your roadmap yet"]),
          el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", marginTop: "6px", lineHeight: "1.5" } }, [
            "Save a few lesson plan parts on the Learning Roadmap screen and your progress will show up here.",
          ]),
        ])
      );
      return;
    }

    // Overdue is a cross-cutting subset of not_started/in_progress, not
    // a fourth mutually-exclusive status — it's shown as its own
    // callout rather than folded into the pie, which would otherwise
    // double-count items and make the percentages misleading.
    if (overdueCount > 0) {
      bodySlot.appendChild(
        el("div", {
          className: "card",
          style: { display: "flex", alignItems: "center", gap: "12px", padding: "14px 18px", marginBottom: "16px", border: "1.5px solid var(--red)", background: "var(--red-bg)" },
        }, [
          iconEl("alert-triangle", 20, "var(--red)", 2),
          el("div", { style: { flex: "1" } }, [
            el("div", { style: { fontSize: "14px", fontWeight: "700", color: "var(--red)" } }, [
              `${overdueCount} ${overdueCount === 1 ? "lesson" : "lessons"} overdue`,
            ]),
            el("div", { style: { fontSize: "12px", color: "var(--red)", opacity: 0.85 } }, ["Past their due date and not marked done"]),
          ]),
        ])
      );
    }

    const segments = [
      { label: "Not started", value: counts.not_started, color: "#9A9FAC" },
      { label: "In progress", value: counts.in_progress, color: "#F2C94C" },
      { label: "Done", value: counts.done, color: "#8FD19E" },
    ];

    const row = el("div", { style: { display: "flex", gap: "24px", alignItems: "center", flexWrap: "wrap" } });

    // Number cards
    const numberCards = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px", flex: "0 0 220px" } });
    segments.forEach(s => {
      numberCards.appendChild(
        el("div", { className: "card", style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px" } }, [
          el("div", { style: { display: "flex", alignItems: "center", gap: "10px" } }, [
            el("span", { style: { width: "10px", height: "10px", borderRadius: "3px", background: s.color, display: "inline-block" } }),
            el("span", { style: { fontSize: "13.5px", fontWeight: "600" } }, [s.label]),
          ]),
          el("span", { className: "mono", style: { fontSize: "20px", fontWeight: "700" } }, [String(s.value)]),
        ])
      );
    });

    // Donut card
    const donutCard = el("div", { className: "card", style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "24px", flex: "0 0 auto" } }, [
      buildDonutChart(segments),
      el("div", { style: { display: "flex", gap: "16px" } },
        segments.map(s =>
          el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, [
            el("span", { style: { width: "9px", height: "9px", borderRadius: "2px", background: s.color, display: "inline-block" } }),
            el("span", { style: { fontSize: "12px", color: "var(--ink-soft)" } }, [`${s.label} (${s.value})`]),
          ])
        )
      ),
    ]);

    row.appendChild(numberCards);
    row.appendChild(donutCard);
    bodySlot.appendChild(row);
  }

  load();

  // ---------- Badges ----------
  const badgeSection = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
  content.appendChild(el("div", { className: "label-eyebrow" }, ["Completion badges"]));
  content.appendChild(badgeSection);

  (async () => {
    try {
      const res = await fetch("/api/badges", { credentials: "include" });
      const data = await res.json();
      const badges = data.badges || [];
      if (badges.length === 0) {
        badgeSection.appendChild(
          el("div", { className: "card-flat", style: { fontSize: "12.5px", color: "var(--ink-faint)" } }, [
            "Complete a lesson to earn your first badge — it will appear here.",
          ])
        );
      } else {
        const grid = el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } });
        badges.forEach(badge => {
          grid.appendChild(
            el("div", { className: "card", style: { display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", flex: "0 0 auto" } }, [
              el("div", { style: { fontSize: "22px" } }, ["🏅"]),
              el("div", null, [
                el("div", { style: { fontSize: "13px", fontWeight: "700" } }, [badge.title]),
                el("div", { style: { fontSize: "11.5px", color: "var(--ink-faint)" } }, [
                  new Date(badge.badge_earned_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
                ]),
              ]),
            ])
          );
        });
        badgeSection.appendChild(grid);
      }
    } catch (e) {
      badgeSection.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, ["Couldn't load badges."]));
    }
  })();

  return container;
}

window.ScreenAnalytics = { buildAnalyticsScreen };

})();
