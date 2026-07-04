(function(){
const { el, iconEl, clear } = window.DOMHelpers;
const { buildTopbar, showToast } = window.UIShared;
const { buildFormatControls } = window.ConversationShared;

function buildManagerScreen() {
  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });
  container.appendChild(buildTopbar("Manage team", "Assign reports, and send lessons straight to their roadmap"));

  const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "18px", maxWidth: "760px" } });
  container.appendChild(content);

  content.appendChild(
    el("div", { className: "card-flat", style: { background: "var(--indigo-soft)" } }, [
      el("div", { style: { fontSize: "12.5px", lineHeight: "1.5", color: "var(--indigo-deep)" } }, [
        "Add someone as your report below, then assign them a lesson plan directly — it lands in their Learning Roadmap automatically. People must have signed in at least once before you can add them.",
      ]),
    ])
  );

  // ---------- Add a report ----------
  const addCard = el("div", { className: "card" }, [
    el("div", { className: "label-eyebrow", style: { marginBottom: "10px" } }, ["Add a report"]),
  ]);
  const emailInput = el("input", {
    placeholder: "teammate@gmail.com",
    style: { flex: "1", border: "1px solid var(--line)", borderRadius: "10px", padding: "10px 12px", fontSize: "13.5px" },
  });
  const addBtn = el("button", { className: "btn btn-primary" }, ["Add"]);
  addCard.appendChild(el("div", { style: { display: "flex", gap: "10px" } }, [emailInput, addBtn]));
  content.appendChild(addCard);

  addBtn.onclick = () => addReport(emailInput.value);
  emailInput.addEventListener("keydown", e => { if (e.key === "Enter") addReport(emailInput.value); });

  async function addReport(email) {
    if (!email || !email.trim()) return;
    try {
      const res = await fetch("/api/manager/assign-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Couldn't add that person.");
        return;
      }
      emailInput.value = "";
      showToast("Added to your team");
      loadTeam();
    } catch (e) {
      showToast("Couldn't reach the server.");
    }
  }

  // ---------- Team list + assign lesson ----------
  content.appendChild(el("div", { className: "label-eyebrow" }, ["Your team"]));
  const teamSlot = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
  content.appendChild(teamSlot);

  let team = [];
  let selectedReport = null;

  async function loadTeam() {
    clear(teamSlot);
    teamSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--ink-faint)" } }, ["Loading…"]));
    try {
      const res = await fetch("/api/manager/team", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        clear(teamSlot);
        teamSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, [data.error || "Couldn't load your team."]));
        return;
      }
      team = data.reports || [];
      renderTeam();
    } catch (e) {
      clear(teamSlot);
      teamSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, ["Couldn't reach the server."]));
    }
  }

  function renderTeam() {
    clear(teamSlot);
    if (team.length === 0) {
      teamSlot.appendChild(
        el("div", { className: "card", style: { textAlign: "center", padding: "24px" } }, [
          el("div", { style: { fontSize: "13px", color: "var(--ink-faint)" } }, ["No reports yet — add one above."]),
        ])
      );
      return;
    }
    team.forEach(person => {
      const isSelected = selectedReport === person.email;
      teamSlot.appendChild(
        el("div", {
          className: "card",
          style: { display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", border: isSelected ? "1.5px solid var(--indigo)" : "0.5px solid var(--line)" },
          onclick: () => { selectedReport = person.email; renderTeam(); renderAssignPanel(); },
        }, [
          el("div", null, [
            el("div", { style: { fontSize: "13.5px", fontWeight: "700" } }, [person.display_name || person.email]),
            el("div", { style: { fontSize: "12px", color: "var(--ink-soft)" } }, [person.email]),
          ]),
          el("span", { className: "pill pill-gray" }, [person.role]),
        ])
      );
    });
  }

  // ---------- Assign a lesson to the selected report ----------
  content.appendChild(el("div", { className: "label-eyebrow" }, ["Assign a lesson"]));
  const assignSlot = el("div");
  content.appendChild(assignSlot);

  let assignPlan = null;
  let assignSelectedParts = new Set();

  function renderAssignPanel() {
    clear(assignSlot);
    if (!selectedReport) {
      assignSlot.appendChild(el("div", { className: "card-flat", style: { fontSize: 13, color: "var(--ink-faint)" } }, ["Select someone from your team above first."]));
      return;
    }

    const panel = el("div", { className: "card" }, [
      el("div", { style: { fontSize: "13px", fontWeight: "700", marginBottom: "10px" } }, [`Assigning to ${selectedReport}`]),
    ]);
    const topicInput = el("input", {
      placeholder: "Lesson topic, e.g. Objection handling for procurement…",
      style: { flex: "1", border: "1px solid var(--line)", borderRadius: "10px", padding: "10px 12px", fontSize: "13.5px" },
    });
    const dueDateInput = el("input", {
      type: "date",
      title: "Due date (optional)",
      style: { border: "1px solid var(--line)", borderRadius: "10px", padding: "10px 12px", fontSize: "13.5px" },
    });
    const genBtn = el("button", { className: "btn btn-primary" }, ["Generate"]);
    panel.appendChild(el("div", { style: { display: "flex", gap: "10px" } }, [topicInput, dueDateInput, genBtn]));

    const planSlot = el("div", { style: { marginTop: "12px" } });
    panel.appendChild(planSlot);
    assignSlot.appendChild(panel);

    genBtn.onclick = () => generateForAssign(topicInput.value, planSlot, dueDateInput.value);
    topicInput.addEventListener("keydown", e => { if (e.key === "Enter") generateForAssign(topicInput.value, planSlot, dueDateInput.value); });
  }

  async function generateForAssign(topic, planSlot, dueDate) {
    if (!topic || !topic.trim()) return;
    clear(planSlot);
    planSlot.appendChild(
      el("div", { className: "card-flat", style: { display: "flex", gap: 10, alignItems: "center" } }, [
        el("div", { className: "typing-dots" }, [el("span"), el("span"), el("span")]),
        el("span", { style: { fontSize: 13 } }, ["Building a lesson plan…"]),
      ])
    );
    try {
      const res = await fetch("/api/lesson-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ topic }),
      });
      const data = await res.json();
      if (!res.ok) {
        clear(planSlot);
        planSlot.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, [data.error || "Couldn't generate a lesson plan."]));
        return;
      }
      assignPlan = data;
      assignSelectedParts = new Set(data.parts.map((_, i) => i));
      renderAssignPlan(planSlot, dueDate);
    } catch (e) {
      clear(planSlot);
      planSlot.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, ["Couldn't reach the server."]));
    }
  }

  function renderAssignPlan(planSlot, dueDate) {
    clear(planSlot);
    if (!assignPlan) return;

    const wrap = el("div", null, [
      el("div", { style: { fontSize: "14px", fontWeight: "700", marginBottom: "8px" } }, [assignPlan.title]),
    ]);
    assignPlan.parts.forEach((part, i) => {
      const checked = assignSelectedParts.has(i);
      const checkbox = el("input", {
        type: "checkbox",
        checked,
        onchange: (e) => { if (e.target.checked) assignSelectedParts.add(i); else assignSelectedParts.delete(i); },
      });

      const contentSlot = el("div", { style: { display: "none", marginTop: "8px", paddingTop: "8px", borderTop: "0.5px solid var(--line)" } });
      let expanded = false;
      let formatControlsBuilt = false;
      const expandBtn = el("button", {
        className: "pill pill-gray pill-clickable",
        style: { marginTop: "6px" },
        onclick: () => {
          expanded = !expanded;
          contentSlot.style.display = expanded ? "block" : "none";
          clear(expandBtn);
          expandBtn.appendChild(iconEl(expanded ? "chevron-down" : "chevron-right", 12, "var(--ink-soft)", 2));
          expandBtn.appendChild(document.createTextNode(expanded ? " Hide" : " Preview"));
          if (expanded && !formatControlsBuilt) {
            formatControlsBuilt = true;
            contentSlot.appendChild(
              window.ContentFormatter.buildFormattedContent(part.content || "", { fontSize: "12.5px", marginBottom: "8px" })
            );
            if (!part._textSourceWrapper) part._textSourceWrapper = { get text() { return part.content; } };
            contentSlot.appendChild(buildFormatControls(part._textSourceWrapper));
          }
        },
      }, [iconEl("chevron-right", 12, "var(--ink-soft)", 2), " Preview"]);

      wrap.appendChild(
        el("div", { className: "card-flat", style: { padding: "10px 12px", marginBottom: "6px" } }, [
          el("div", { style: { display: "flex", gap: "10px", alignItems: "flex-start" } }, [
            checkbox,
            el("div", { style: { flex: "1" } }, [
              el("div", { style: { fontSize: "13px", fontWeight: "700" } }, [part.title]),
              el("div", { style: { fontSize: "12px", color: "var(--ink-soft)" } }, [part.summary]),
            ]),
          ]),
          expandBtn,
          contentSlot,
        ])
      );
    });
    wrap.appendChild(
      el("button", { className: "btn btn-primary", style: { marginTop: "8px" }, onclick: () => confirmAssign(dueDate) }, [
        iconEl("send", 14, "#fff", 2), `Assign to ${selectedReport}`,
      ])
    );
    planSlot.appendChild(wrap);
  }

  async function confirmAssign(dueDate) {
    if (!assignPlan || assignSelectedParts.size === 0) {
      showToast("Select at least one part first.");
      return;
    }
    const items = Array.from(assignSelectedParts).map(i => {
      const part = assignPlan.parts[i];
      return { title: part.title, summary: part.summary, content: part.content, dueDate: dueDate || null };
    });
    try {
      const res = await fetch("/api/manager/assign-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reportEmail: selectedReport, lessonPlanId: assignPlan.id, items }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Couldn't assign that lesson.");
        return;
      }
      showToast(`Assigned ${items.length} part${items.length > 1 ? "s" : ""} to ${selectedReport}`);
      assignPlan = null;
      renderAssignPanel();
    } catch (e) {
      showToast("Couldn't reach the server.");
    }
  }

  renderAssignPanel();
  loadTeam();

  // ---------- Team assignments — completion status across the team ----------
  content.appendChild(el("div", { className: "label-eyebrow" }, ["Team assignments"]));
  const assignmentsSlot = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
  content.appendChild(assignmentsSlot);

  const ASSIGNMENT_STATUS_META = {
    not_started: { label: "Not started", cls: "pill-gray" },
    in_progress: { label: "In progress", cls: "pill-amber" },
    done: { label: "Done", cls: "pill-green" },
  };

  async function loadAssignments() {
    clear(assignmentsSlot);
    assignmentsSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--ink-faint)" } }, ["Loading…"]));
    try {
      const res = await fetch("/api/manager/assignments", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        clear(assignmentsSlot);
        assignmentsSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, [data.error || "Couldn't load assignments."]));
        return;
      }
      renderAssignments(data.assignments || []);
    } catch (e) {
      clear(assignmentsSlot);
      assignmentsSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, ["Couldn't reach the server."]));
    }
  }

  function renderAssignments(assignments) {
    clear(assignmentsSlot);
    if (assignments.length === 0) {
      assignmentsSlot.appendChild(
        el("div", { className: "card", style: { textAlign: "center", padding: "24px" } }, [
          el("div", { style: { fontSize: "13px", color: "var(--ink-faint)" } }, ["Nothing assigned yet — assign a lesson above and it'll show up here."]),
        ])
      );
      return;
    }
    assignments.forEach(item => {
      const statusMeta = ASSIGNMENT_STATUS_META[item.status] || ASSIGNMENT_STATUS_META.not_started;
      const isOverdue = item.due_date && item.status !== "done" && new Date(item.due_date + "T00:00:00") < new Date(new Date().toDateString());
      assignmentsSlot.appendChild(
        el("div", { className: "card", style: { display: "flex", alignItems: "center", gap: "12px", padding: "13px 16px", border: isOverdue ? "1.5px solid var(--red)" : "0.5px solid var(--line)" } }, [
          el("div", { style: { flex: "1", minWidth: "0" } }, [
            el("div", { style: { fontSize: "13.5px", fontWeight: "700" } }, [item.title]),
            el("div", { style: { fontSize: "12px", color: "var(--ink-soft)", marginTop: "2px" } }, [
              item.report_display_name || item.owner_email,
              item.due_date ? ` · Due ${item.due_date}` : "",
            ]),
          ]),
          isOverdue ? el("span", { className: "pill", style: { background: "var(--red-bg)", color: "var(--red)" } }, ["Overdue"]) : null,
          el("span", { className: `pill ${statusMeta.cls}` }, [statusMeta.label]),
        ])
      );
    });
  }

  loadAssignments();
  // Lightweight polling, not a full real-time system — refreshes every
  // 30s so completion status updates while this screen stays open,
  // without the complexity of websockets for something this low-stakes.
  const assignmentsPollId = setInterval(loadAssignments, 30000);
  // Clean up the poll if this screen's DOM node gets removed from the
  // page (navigating elsewhere in the app).
  const observer = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      clearInterval(assignmentsPollId);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ---------- Onboarding tracks ----------
  content.appendChild(el("div", { className: "label-eyebrow" }, ["Onboarding tracks"]));
  content.appendChild(
    el("div", { className: "card-flat", style: { background: "var(--indigo-soft)", fontSize: "12.5px", color: "var(--indigo-deep)", lineHeight: "1.5" } }, [
      "Create a named sequence of lesson topics for new reps to work through in order. Then assign the whole track to someone — it generates and assigns all lessons at once.",
    ])
  );

  const tracksSlot = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
  content.appendChild(tracksSlot);

  async function loadTracks() {
    clear(tracksSlot);
    tracksSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--ink-faint)" } }, ["Loading…"]));
    try {
      const res = await fetch("/api/manager/tracks", { credentials: "include" });
      const data = await res.json();
      renderTracks(data.tracks || []);
    } catch (e) {
      clear(tracksSlot);
      tracksSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, ["Couldn't load tracks."]));
    }
  }

  function renderTracks(tracks) {
    clear(tracksSlot);

    // New track form
    const newCard = el("div", { className: "card" }, [
      el("div", { className: "label-eyebrow", style: { marginBottom: "8px" } }, ["Create a new track"]),
    ]);
    const trackNameInput = el("input", { placeholder: "Track name, e.g. New rep onboarding", style: { border: "1px solid var(--line)", borderRadius: "10px", padding: "10px 12px", fontSize: "13px", width: "100%", marginBottom: "8px" } });
    const topicsInput = el("textarea", { placeholder: "Topics (one per line):\nDiscovery call techniques\nObjection handling basics\nCompetitor overview", style: { border: "1px solid var(--line)", borderRadius: "10px", padding: "10px 12px", fontSize: "13px", minHeight: "80px", fontFamily: "inherit", resize: "vertical", width: "100%", marginBottom: "8px" } });
    const createTrackBtn = el("button", { className: "btn btn-primary btn-sm" }, [iconEl("plus", 12, "#fff", 2), " Create track"]);
    newCard.appendChild(trackNameInput);
    newCard.appendChild(topicsInput);
    newCard.appendChild(createTrackBtn);
    tracksSlot.appendChild(newCard);

    createTrackBtn.onclick = async () => {
      const name = trackNameInput.value.trim();
      const topics = topicsInput.value.split("\n").map(t => t.trim()).filter(Boolean);
      if (!name) { showToast("Give the track a name."); return; }
      if (topics.length === 0) { showToast("Add at least one topic."); return; }
      try {
        const res = await fetch("/api/manager/tracks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name, topics }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || "Couldn't create that track."); return; }
        trackNameInput.value = "";
        topicsInput.value = "";
        showToast("Track created");
        loadTracks();
      } catch (e) { showToast("Couldn't reach the server."); }
    };

    if (tracks.length === 0) return;

    tracks.forEach(track => {
      const topics = Array.isArray(track.topics) ? track.topics.filter(Boolean) : [];
      const trackCard = el("div", { className: "card" }, [
        el("div", { className: "row", style: { marginBottom: "8px" } }, [
          el("div", { style: { fontSize: "13.5px", fontWeight: "700" } }, [track.name]),
          el("span", { className: "pill pill-gray" }, [`${topics.length} lesson${topics.length !== 1 ? "s" : ""}`]),
        ]),
      ]);
      topics.forEach((topic, i) => {
        trackCard.appendChild(
          el("div", { style: { display: "flex", gap: "8px", fontSize: "12.5px", color: "var(--ink-soft)", padding: "4px 0" } }, [
            el("span", { style: { color: "var(--ink-faint)", flex: "0 0 20px" } }, [`${i + 1}.`]),
            el("span", null, [topic]),
          ])
        );
      });

      const assignRow = el("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
      const assignEmailInput = el("input", { placeholder: "Assign to (email)…", style: { flex: "1", border: "1px solid var(--line)", borderRadius: "8px", padding: "8px 10px", fontSize: "12.5px" } });
      const assignTrackBtn = el("button", { className: "btn btn-secondary btn-sm" }, [iconEl("send", 12, "var(--navy)", 2), " Assign"]);
      assignTrackBtn.onclick = async () => {
        const assigneeEmail = assignEmailInput.value.trim();
        if (!assigneeEmail) return;
        try {
          const res = await fetch(`/api/manager/tracks/${track.id}/assign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ assigneeEmail }),
          });
          const data = await res.json();
          if (!res.ok) { showToast(data.error || "Couldn't assign that track."); return; }
          showToast(`Track assigned to ${assigneeEmail}`);
          assignEmailInput.value = "";
        } catch (e) { showToast("Couldn't reach the server."); }
      };
      assignRow.appendChild(assignEmailInput);
      assignRow.appendChild(assignTrackBtn);
      trackCard.appendChild(assignRow);
      tracksSlot.appendChild(trackCard);
    });
  }

  loadTracks();

  return container;
}

window.ScreenManager = { buildManagerScreen };

})();
