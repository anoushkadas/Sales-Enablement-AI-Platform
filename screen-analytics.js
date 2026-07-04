(function(){
const { el, iconEl } = window.DOMHelpers;
const { buildTopbar } = window.UIShared;

function svgEl(tag, attrs, children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.keys(attrs || {}).forEach(k => node.setAttribute(k, attrs[k]));
  (children || []).forEach(c => c && node.appendChild(c));
  return node;
}

function buildLineChart(data, opts) {
  opts = opts || {};
  const w = opts.w || 600, h = opts.h || 190, color = opts.color || "#5B5FE9";
  const padL = 36, padR = 12, padT = 14, padB = 24;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const maxY = Math.max.apply(null, data.map(d => d.y)) * 1.15;
  const minY = Math.min(4, Math.min.apply(null, data.map(d => d.y)) * 0.9);
  const stepX = innerW / (data.length - 1);
  const points = data.map((d, i) => [padL + i * stepX, padT + innerH - ((d.y - minY) / (maxY - minY)) * innerH]);
  const pathD = points.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const areaD = pathD + ` L${points[points.length - 1][0].toFixed(1)},${padT + innerH} L${points[0][0].toFixed(1)},${padT + innerH} Z`;

  const svg = svgEl("svg", { width: "100%", viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": "Manager-rated score trending up over 8 weeks" });
  for (let i = 0; i < 4; i++) {
    const y = padT + (innerH / 3) * i;
    svg.appendChild(svgEl("line", { x1: padL, y1: y, x2: w - padR, y2: y, stroke: "#E7E4DC", "stroke-width": 1 }));
  }
  svg.appendChild(svgEl("path", { d: areaD, fill: color, opacity: 0.08 }));
  svg.appendChild(svgEl("path", { d: pathD, fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  points.forEach(p => svg.appendChild(svgEl("circle", { cx: p[0], cy: p[1], r: 3.5, fill: color })));
  data.forEach((d, i) => {
    const t = svgEl("text", { x: padL + i * stepX, y: h - 6, "font-size": 10.5, fill: "#9A9FAC", "text-anchor": "middle" });
    t.textContent = d.label;
    svg.appendChild(t);
  });
  return svg;
}

function buildDonutChart(segments, size) {
  size = size || 160;
  const cx = size / 2, cy = size / 2, r = size / 2 - 14, stroke = 18;
  const total = segments.reduce((a, s) => a + s.value, 0);
  let angle = -90;
  const circ = 2 * Math.PI * r;
  const svg = svgEl("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": "Practice mix breakdown by mode this month" });
  segments.forEach(s => {
    const frac = s.value / total;
    const len = frac * circ;
    const gap = 3;
    const dasharray = `${Math.max(len - gap, 0).toFixed(1)} ${(circ - len + gap).toFixed(1)}`;
    const rotate = angle;
    angle += frac * 360;
    svg.appendChild(svgEl("circle", {
      cx, cy, r, fill: "none", stroke: s.color, "stroke-width": stroke,
      "stroke-dasharray": dasharray, "stroke-linecap": "round",
      transform: `rotate(${rotate} ${cx} ${cy})`,
    }));
  });
  return svg;
}

function buildHBarChart(data, w) {
  w = w || 600;
  const rowH = 30, gap = 12;
  const labelW = 150;
  const maxX = 100;
  const barAreaW = w - labelW - 50;
  const h = data.length * (rowH + gap);
  const svg = svgEl("svg", { width: "100%", viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": "Skill readiness percentage by sales stage" });
  data.forEach((d, i) => {
    const y = i * (rowH + gap);
    const barW = (d.value / maxX) * barAreaW;
    const color = d.warn ? "#993C1D" : "#185FA5";
    const labelText = svgEl("text", { x: 0, y: y + rowH / 2 + 4, "font-size": 12.5, "font-weight": 700, fill: "#21262E" });
    labelText.textContent = d.label;
    const valueText = svgEl("text", { x: labelW + barAreaW + 10, y: y + rowH / 2 + 4, "font-size": 12.5, "font-weight": 700, fill: "#21262E" });
    valueText.textContent = `${d.value}%`;
    svg.appendChild(labelText);
    svg.appendChild(svgEl("rect", { x: labelW, y: y + 3, width: barAreaW, height: rowH - 6, rx: 6, fill: "#F0EEE7" }));
    svg.appendChild(svgEl("rect", { x: labelW, y: y + 3, width: barW, height: rowH - 6, rx: 6, fill: color }));
    svg.appendChild(valueText);
  });
  return svg;
}

function buildAnalyticsScreen() {
  const a = window.APP_DATA.ANALYTICS;
  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });

  container.appendChild(
    buildTopbar("My analytics", "Progress over time", [
      el("button", { className: "pill pill-gray pill-clickable" }, ["Export ", iconEl("download", 12, "var(--ink-soft)", 2)]),
    ])
  );

  const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "18px" } });

  const hasAnyData = a.scoreTrend.length > 0 || a.practiceMix.length > 0 || a.skillByStage.length > 0 || a.badges.length > 0;
  if (!hasAnyData) {
    content.appendChild(
      el("div", { className: "card", style: { textAlign: "center", padding: "40px 24px", maxWidth: "460px", margin: "40px auto" } }, [
        iconEl("chart-bar", 28, "var(--ink-faint)", 1.6),
        el("div", { style: { fontSize: "15px", fontWeight: "700", marginTop: "12px" } }, ["No analytics yet"]),
        el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", marginTop: "6px", lineHeight: "1.5" } }, [
          "This dashboard will fill in once there's real usage and scoring data to show — manager call ratings, practice session counts, and skill readiness by sales stage.",
        ]),
      ])
    );
    container.appendChild(content);
    return container;
  }

  const metricCards = [
    { label: "Overall readiness", value: a.overallReadiness.value, delta: a.overallReadiness.delta },
    { label: "Manager call score", value: a.managerScore.value, delta: a.managerScore.delta },
    { label: "Practice reps / week", value: a.practiceReps.value, delta: a.practiceReps.delta },
    { label: "Time to first deal", value: a.timeToFirstDeal.value, delta: a.timeToFirstDeal.delta },
  ];
  const metricGrid = el("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px" } });
  metricCards.forEach(m => {
    metricGrid.appendChild(
      el("div", { className: "card" }, [
        el("div", { className: "label-eyebrow", style: { marginBottom: "8px" } }, [m.label]),
        el("div", { className: "row", style: { alignItems: "baseline" } }, [
          el("span", { className: "mono", style: { fontSize: "28px", fontWeight: "700" } }, [m.value]),
          m.delta ? el("span", { className: "pill pill-green" }, [m.delta]) : null,
        ]),
      ])
    );
  });
  content.appendChild(metricGrid);

  const chartRow1 = el("div", { style: { display: "flex", gap: "14px" } });
  const lineCard = el("div", { className: "card", style: { flex: "1.4" } }, [
    el("div", { className: "row", style: { marginBottom: "6px" } }, [
      el("div", { className: "label-eyebrow" }, ["Manager-rated score over time"]),
      el("span", { className: "pill pill-indigo" }, ["Trending up"]),
    ]),
  ]);
  if (a.scoreTrend.length > 0) {
    lineCard.appendChild(buildLineChart(a.scoreTrend));
  } else {
    lineCard.appendChild(el("div", { style: { padding: "24px", textAlign: "center", color: "var(--ink-faint)", fontSize: "13px" } }, ["No score history yet"]));
  }
  chartRow1.appendChild(lineCard);

  const donutCard = el("div", { className: "card", style: { flex: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" } }, [
    el("div", { className: "label-eyebrow", style: { marginBottom: "14px", alignSelf: "flex-start" } }, ["Practice mix this month"]),
  ]);
  const donutRow = el("div", { style: { display: "flex", alignItems: "center", gap: "20px" } });
  if (a.practiceMix.length > 0) {
    donutRow.appendChild(buildDonutChart(a.practiceMix));
    const legend = el("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } });
    a.practiceMix.forEach(s => {
      legend.appendChild(
        el("div", { style: { display: "flex", alignItems: "center", gap: "7px" } }, [
          el("span", { style: { width: "9px", height: "9px", borderRadius: "2px", background: s.color, display: "inline-block" } }),
          el("span", { style: { fontSize: "12px" } }, [`${s.label} ${s.value}%`]),
        ])
      );
    });
    donutRow.appendChild(legend);
  } else {
    donutRow.appendChild(el("div", { style: { padding: "12px", color: "var(--ink-faint)", fontSize: "13px" } }, ["No practice sessions logged yet"]));
  }
  donutCard.appendChild(donutRow);
  chartRow1.appendChild(donutCard);
  content.appendChild(chartRow1);

  const chartRow2 = el("div", { style: { display: "flex", gap: "14px" } });
  const barCard = el("div", { className: "card", style: { flex: "1" } }, [
    el("div", { className: "label-eyebrow", style: { marginBottom: "14px" } }, ["Skill readiness by sales stage"]),
  ]);
  if (a.skillByStage.length > 0) {
    barCard.appendChild(buildHBarChart(a.skillByStage));
  } else {
    barCard.appendChild(el("div", { style: { padding: "24px", textAlign: "center", color: "var(--ink-faint)", fontSize: "13px" } }, ["No skill scoring data yet"]));
  }
  chartRow2.appendChild(barCard);

  const badgeCard = el("div", { className: "card", style: { width: "320px", flex: "0 0 320px" } }, [
    el("div", { className: "label-eyebrow", style: { marginBottom: "12px" } }, ["Badges & milestones"]),
  ]);
  const badgeList = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
  if (a.badges.length === 0) {
    badgeList.appendChild(el("div", { style: { fontSize: "13px", color: "var(--ink-faint)" } }, ["No badges earned yet"]));
  } else {
    a.badges.forEach((b, i) => {
      if (i > 0) badgeList.appendChild(el("div", { className: "divider" }));
      badgeList.appendChild(
        el("div", { className: "row", style: { padding: "8px 0" } }, [
          el("div", { style: { display: "flex", alignItems: "center", gap: "10px" } }, [
            iconEl(b.icon, 18, b.color, 1.9),
            el("span", { style: { fontSize: "13px", fontWeight: "600" } }, [b.title]),
          ]),
          el("span", { style: { fontSize: "11.5px", color: "var(--ink-faint)" } }, [b.date]),
        ])
      );
    });
  }
  badgeCard.appendChild(badgeList);
  chartRow2.appendChild(badgeCard);
  content.appendChild(chartRow2);

  container.appendChild(content);
  return container;
}

window.ScreenAnalytics = { buildAnalyticsScreen };

})();
