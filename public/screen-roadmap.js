(function(){
const { el, iconEl, clear } = window.DOMHelpers;
const { buildTopbar, showToast } = window.UIShared;
const { buildFormatControls } = window.ConversationShared;

function emptyState(icon, title, body) {
  return el("div", { className: "card", style: { textAlign: "center", padding: "32px 24px" } }, [
    iconEl(icon, 28, "var(--ink-faint)", 1.6),
    el("div", { style: { fontSize: "15px", fontWeight: "700", marginTop: "12px" } }, [title]),
    el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", marginTop: "6px", lineHeight: "1.5", maxWidth: "360px", margin: "6px auto 0" } }, [body]),
  ]);
}

function buildDueDateTag(dueDateStr, status) {
  if (!dueDateStr) return null;
  if (status === "done") {
    return el("span", { className: "pill pill-gray" }, [iconEl("clock", 11, "var(--ink-soft)", 2), ` Due ${dueDateStr}`]);
  }
  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(dueDateStr + "T00:00:00");
  const daysUntilDue = Math.round((due - today) / (24*60*60*1000));
  let style = { background: "var(--line-soft)", color: "var(--ink-soft)" };
  if (daysUntilDue < 0) style = { background: "var(--red-bg)", color: "var(--red)" };
  else if (daysUntilDue <= 2) style = { background: "#FCEFC7", color: "#854F0B" };
  return el("span", { className: "pill", style }, [iconEl("clock", 11, "currentColor", 2), ` Due ${dueDateStr}`]);
}

// =====================================================================
// ROADMAP SCREEN — three tabs: Roadmap, Notes, Analytics
// =====================================================================
function buildRoadmapScreen() {
  let roadmapItems = [];
  let currentPlan = null;
  let selectedParts = new Set();
  let activeTab = "roadmap"; // "roadmap" | "notes" | "analytics"

  const container = el("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } });

  // ---------- Topbar with tab switcher ----------
  const topbarSlot = el("div");
  container.appendChild(topbarSlot);

  function renderTopbar() {
    clear(topbarSlot);
    const tabs = [
      { id: "roadmap", label: "Learning path", icon: "map" },
      { id: "notes", label: "Notes", icon: "list" },
      { id: "analytics", label: "Analytics", icon: "chart-bar" },
    ];
    topbarSlot.appendChild(
      buildTopbar("Learning roadmap", "Your personal learning path — read, quiz, earn certificates", [
        el("div", { style: { display: "flex", gap: "6px" } },
          tabs.map(t =>
            el("button", {
              className: `pill pill-clickable ${activeTab === t.id ? "pill-navy" : "pill-gray"}`,
              onclick: () => { activeTab = t.id; renderTopbar(); renderBody(); },
            }, [iconEl(t.icon, 12, activeTab === t.id ? "#fff" : "var(--ink-soft)", 2), ` ${t.label}`])
          )
        ),
      ])
    );
  }

  const bodySlot = el("div", { style: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column" } });
  container.appendChild(bodySlot);

  function renderBody() {
    clear(bodySlot);
    if (activeTab === "roadmap") bodySlot.appendChild(buildRoadmapTab());
    else if (activeTab === "notes") bodySlot.appendChild(buildNotesTab());
    else if (activeTab === "analytics") bodySlot.appendChild(buildAnalyticsTab());
  }

  // =====================================================================
  // ROADMAP TAB
  // =====================================================================
  function buildRoadmapTab() {
    const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "18px" } });

    // ---------- Overdue ----------
    const overdueSlot = el("div");
    content.appendChild(overdueSlot);
    loadOverdue(overdueSlot);

    // ---------- Generate a learning path ----------
    const generatorCard = el("div", { className: "card" }, [
      el("div", { className: "label-eyebrow", style: { marginBottom: "6px" } }, ["Generate a learning path"]),
      el("div", { style: { fontSize: "12.5px", color: "var(--ink-soft)", marginBottom: "10px" } }, [
        "Each lesson includes a quiz. Pass the quiz to unlock the next lesson and earn a certificate when the whole path is complete.",
      ]),
    ]);
    const topicInput = el("input", {
      className: "lesson-topic-input",
      placeholder: "e.g. Negotiating with procurement, Healthcare vertical…",
      style: { flex: "1", border: "1px solid var(--line)", borderRadius: "10px", padding: "10px 12px", fontSize: "13.5px" },
    });
    const generateBtn = el("button", { className: "btn btn-primary" }, ["Generate"]);
    generatorCard.appendChild(el("div", { style: { display: "flex", gap: "10px" } }, [topicInput, generateBtn]));
    content.appendChild(generatorCard);

    const planSlot = el("div");
    content.appendChild(planSlot);

    generateBtn.onclick = () => generatePlan(topicInput.value, planSlot);
    topicInput.addEventListener("keydown", e => { if (e.key === "Enter") generatePlan(topicInput.value, planSlot); });

    // ---------- Condensed summary ----------
    const condensedSlot = el("div");
    content.appendChild(condensedSlot);

    // ---------- Saved learning path list ----------
    let sortBy = "assigned_date";
    content.appendChild(
      el("div", { className: "row" }, [
        el("div", { className: "label-eyebrow" }, ["Your learning paths"]),
        el("select", {
          style: { fontSize: "12.5px", border: "1px solid var(--line)", borderRadius: "8px", padding: "6px 8px" },
          onchange: (e) => { sortBy = e.target.value; loadRoadmap(); },
        }, [
          el("option", { value: "assigned_date" }, ["Sort: by assigned date"]),
          el("option", { value: "due_date" }, ["Sort: by due date"]),
          el("option", { value: "status" }, ["Sort: by status"]),
        ]),
      ])
    );
    const roadmapListSlot = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
    content.appendChild(roadmapListSlot);

    const suggestionsSlot = el("div");
    content.appendChild(suggestionsSlot);

    async function loadOverdue(slot) {
      try {
        const res = await fetch("/api/roadmap/overdue", { credentials: "include" });
        const data = await res.json();
        const overdueItems = data.items || [];
        clear(slot);
        if (overdueItems.length === 0) return;
        const card = el("div", { className: "card", style: { border: "1.5px solid var(--red)", background: "var(--red-bg)" } }, [
          el("div", { className: "row", style: { marginBottom: "10px" } }, [
            el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [
              iconEl("alert-triangle", 16, "var(--red)", 2),
              el("div", { className: "label-eyebrow", style: { color: "var(--red)" } }, ["Overdue"]),
            ]),
            el("span", { className: "pill", style: { background: "var(--red)", color: "#fff" } }, [String(overdueItems.length)]),
          ]),
        ]);
        overdueItems.forEach((item, i) => {
          if (i > 0) card.appendChild(el("div", { className: "divider", style: { margin: "8px 0" } }));
          card.appendChild(el("div", { className: "row" }, [
            el("div", null, [
              el("div", { style: { fontSize: "13.5px", fontWeight: "700" } }, [item.title]),
              el("div", { style: { fontSize: "11.5px", color: "var(--red)" } }, [`Was due ${item.due_date}`]),
            ]),
            el("span", { className: "pill pill-gray" }, [item.status === "in_progress" ? "In progress" : "Not started"]),
          ]));
        });
        slot.appendChild(card);
      } catch (e) { clear(slot); }
    }

    async function generatePlan(topic, planSlot) {
      if (!topic || !topic.trim()) return;
      clear(planSlot);
      planSlot.appendChild(el("div", { className: "card-flat", style: { display: "flex", gap: 10, alignItems: "center" } }, [
        el("div", { className: "typing-dots" }, [el("span"), el("span"), el("span")]),
        el("span", { style: { fontSize: 13 } }, ["Building your learning path…"]),
      ]));
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
          planSlot.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, [data.error || "Couldn't generate a learning path."]));
          return;
        }
        currentPlan = data;
        selectedParts = new Set(data.parts.map((_, i) => i));
        renderPlan(planSlot);
      } catch (e) {
        clear(planSlot);
        planSlot.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, ["Couldn't reach the server."]));
      }
    }

    function renderPlan(planSlot) {
      clear(planSlot);
      if (!currentPlan) return;
      const planCard = el("div", { className: "card" }, [
        el("div", { style: { fontSize: "15px", fontWeight: "700", marginBottom: "4px" } }, [currentPlan.title]),
        el("div", { style: { fontSize: "12.5px", color: "var(--ink-soft)", marginBottom: "14px" } }, [
          `${currentPlan.parts.length} lessons · each with a built-in quiz · complete all to earn a certificate`,
        ]),
      ]);
      currentPlan.parts.forEach((part, i) => {
        const hasQuiz = Array.isArray(part.quiz) && part.quiz.length > 0;
        const checkbox = el("input", {
          type: "checkbox",
          checked: selectedParts.has(i),
          onchange: (e) => { if (e.target.checked) selectedParts.add(i); else selectedParts.delete(i); },
          style: { marginTop: "3px", flex: "0 0 auto" },
        });
        const dueDateInput = el("input", {
          type: "date",
          title: "Due date (optional)",
          style: { fontSize: "12px", border: "1px solid var(--line)", borderRadius: "8px", padding: "5px 8px", marginLeft: "auto" },
          onchange: (e) => { part._dueDate = e.target.value || null; },
        });
        planCard.appendChild(
          el("div", { className: "card-flat", style: { padding: "12px 14px", marginBottom: "8px" } }, [
            el("div", { style: { display: "flex", gap: "10px", alignItems: "flex-start" } }, [
              checkbox,
              el("div", { style: { flex: "1" } }, [
                el("div", { style: { fontSize: "13.5px", fontWeight: "700" } }, [`${i + 1}. ${part.title}`]),
                el("div", { style: { fontSize: "12.5px", color: "var(--ink-soft)", marginTop: "2px" } }, [part.summary]),
                hasQuiz ? el("div", { style: { fontSize: "11.5px", color: "var(--indigo-deep)", marginTop: "4px" } }, [
                  `Includes ${part.quiz.length}-question quiz · must pass to complete`,
                ]) : null,
              ]),
              dueDateInput,
            ]),
          ])
        );
      });
      planCard.appendChild(
        el("button", { className: "btn btn-primary", style: { marginTop: "8px" }, onclick: () => saveSelectedParts(planSlot) }, [
          iconEl("plus", 14, "#fff", 2), "Save to my learning path",
        ])
      );
      planSlot.appendChild(planCard);
    }

    async function saveSelectedParts(planSlot) {
      if (!currentPlan || selectedParts.size === 0) { showToast("Select at least one lesson first."); return; }
      const items = Array.from(selectedParts).map(i => {
        const part = currentPlan.parts[i];
        return { title: part.title, summary: part.summary, content: part.content, quiz: part.quiz || [], dueDate: part._dueDate || null };
      });
      try {
        const res = await fetch("/api/roadmap/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ lessonPlanId: currentPlan.id, items }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || "Couldn't save."); return; }
        showToast(`Saved ${items.length} lesson${items.length > 1 ? "s" : ""} to your learning path`);
        currentPlan = null;
        clear(planSlot);
        loadRoadmap();
      } catch (e) { showToast("Couldn't reach the server."); }
    }

    function renderCondensedView() {
      clear(condensedSlot);
      if (roadmapItems.length === 0) return;
      const counts = { not_started: 0, in_progress: 0, done: 0 };
      let overdueCount = 0;
      const today = new Date(new Date().toDateString());
      roadmapItems.forEach(item => {
        if (counts[item.status] != null) counts[item.status]++;
        if (item.due_date && item.status !== "done" && new Date(item.due_date + "T00:00:00") < today) overdueCount++;
      });
      const chip = (label, value, color) => el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, [
        el("span", { style: { width: "8px", height: "8px", borderRadius: "2px", background: color, display: "inline-block" } }),
        el("span", { style: { fontSize: "12.5px", color: "var(--ink-soft)" } }, [`${value} ${label}`]),
      ]);
      condensedSlot.appendChild(
        el("div", { className: "card-flat", style: { display: "flex", gap: "18px", flexWrap: "wrap", alignItems: "center" } }, [
          chip("not started", counts.not_started, "#9A9FAC"),
          chip("in progress", counts.in_progress, "#F2C94C"),
          chip("done", counts.done, "#8FD19E"),
          overdueCount > 0 ? chip("overdue", overdueCount, "#A32D2D") : null,
        ])
      );
    }

    async function loadRoadmap() {
      clear(roadmapListSlot);
      roadmapListSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--ink-faint)" } }, ["Loading…"]));
      try {
        const res = await fetch(`/api/roadmap?sortBy=${encodeURIComponent(sortBy)}`, { credentials: "include" });
        const data = await res.json();
        roadmapItems = data.items || [];
        renderCondensedView();
        renderRoadmapList();
      } catch (e) {
        clear(roadmapListSlot);
        roadmapListSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, ["Couldn't load your roadmap."]));
      }
    }

    function renderRoadmapList() {
      clear(roadmapListSlot);
      if (roadmapItems.length === 0) {
        roadmapListSlot.appendChild(emptyState("map", "Nothing saved yet", "Generate a learning path above and save the lessons you want to study."));
        return;
      }

      // Group by lesson_plan_id so each path is a visual unit
      const planGroups = new Map();
      const ungrouped = [];
      roadmapItems.forEach(item => {
        if (item.lesson_plan_id) {
          if (!planGroups.has(item.lesson_plan_id)) planGroups.set(item.lesson_plan_id, []);
          planGroups.get(item.lesson_plan_id).push(item);
        } else {
          ungrouped.push(item);
        }
      });

      planGroups.forEach((items, planId) => {
        const allDone = items.every(i => i.status === "done");
        const doneCount = items.filter(i => i.status === "done").length;
        const groupCard = el("div", { className: "card", style: { border: allDone ? "1.5px solid var(--green)" : "0.5px solid var(--line)" } });

        const progressPct = Math.round((doneCount / items.length) * 100);
        groupCard.appendChild(
          el("div", { style: { marginBottom: "12px" } }, [
            el("div", { className: "row", style: { marginBottom: "6px" } }, [
              el("div", { style: { fontSize: "13px", fontWeight: "700" } }, [`${doneCount}/${items.length} lessons complete`]),
              allDone ? el("span", { className: "pill", style: { background: "var(--green-bg)", color: "var(--green)" } }, ["🏆 Complete"]) : null,
            ]),
            el("div", { style: { height: "6px", background: "var(--line-soft)", borderRadius: "3px", overflow: "hidden" } }, [
              el("div", { style: { height: "100%", width: `${progressPct}%`, background: allDone ? "var(--green)" : "var(--indigo)", borderRadius: "3px", transition: "width 0.3s ease" } }),
            ]),
          ])
        );

        items.forEach((item, itemIndex) => {
          const isLocked = itemIndex > 0 && items[itemIndex - 1].status !== "done";
          groupCard.appendChild(buildLessonCard(item, isLocked, suggestionsSlot, loadRoadmap));
        });

        roadmapListSlot.appendChild(groupCard);
      });

      ungrouped.forEach(item => {
        roadmapListSlot.appendChild(buildLessonCard(item, false, suggestionsSlot, loadRoadmap));
      });
    }

    loadRoadmap();
    loadOverdue(overdueSlot);
    return content;
  }

  // =====================================================================
  // Individual lesson card — used inside plan groups and standalone
  // =====================================================================
  function buildLessonCard(item, isLocked, suggestionsSlot, reloadFn) {
    const statusMeta = {
      not_started: { label: "Not started", cls: "pill-gray" },
      in_progress: { label: "In progress", cls: "pill-amber" },
      done: { label: "Done ✓", cls: "pill-green" },
    }[item.status] || { label: item.status, cls: "pill-gray" };

    const quizQuestions = item.quiz_questions || null;
    const contentSlot = el("div", { style: { display: "none", marginTop: "12px", paddingTop: "12px", borderTop: "0.5px solid var(--line)" } });
    let expanded = false;

    const expandBtn = el("button", {
      className: "btn btn-ghost btn-sm",
      style: isLocked ? { opacity: "0.4", cursor: "not-allowed" } : {},
      onclick: () => {
        if (isLocked) { showToast("Complete the previous lesson first."); return; }
        expanded = !expanded;
        contentSlot.style.display = expanded ? "block" : "none";
        expandBtn.textContent = "";
        expandBtn.appendChild(iconEl(expanded ? "chevron-down" : "chevron-right", 13, "var(--ink-soft)", 2));
        expandBtn.appendChild(document.createTextNode(expanded ? " Close" : " Read & quiz"));
        if (expanded && !contentSlot._built) {
          contentSlot._built = true;
          buildLessonContent(item, quizQuestions, contentSlot, suggestionsSlot, reloadFn);
        }
      },
    }, [iconEl("chevron-right", 13, "var(--ink-soft)", 2), isLocked ? " Locked" : " Read & quiz"]);

    const dueDateTag = buildDueDateTag(item.due_date, item.status);
    const assignedTag = item.assigned_by ? el("span", { className: "pill pill-indigo" }, [`Assigned`]) : null;

    const headerRow = el("div", { style: { display: "flex", gap: "12px", alignItems: "flex-start" } }, [
      el("div", { style: { flex: "1" } }, [
        el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [
          isLocked ? el("span", { style: { fontSize: "14px" } }, ["🔒"]) : item.status === "done" ? el("span", { style: { fontSize: "14px" } }, ["✅"]) : null,
          el("div", { style: { fontSize: "13.5px", fontWeight: "700" } }, [item.title]),
        ]),
        item.summary ? el("div", { style: { fontSize: "12px", color: "var(--ink-soft)", marginTop: "2px" } }, [item.summary]) : null,
        el("div", { style: { display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap", alignItems: "center" } }, [
          el("span", { className: `pill ${statusMeta.cls}` }, [statusMeta.label]),
          assignedTag,
          dueDateTag,
          quizQuestions ? el("span", { className: "pill pill-gray" }, [`Quiz: ${quizQuestions.length}Q`]) : null,
        ]),
      ]),
    ]);

    return el("div", { style: { padding: "12px 0", borderTop: "0.5px solid var(--line-soft)" } }, [headerRow, expandBtn, contentSlot]);
  }

  function buildLessonContent(item, quizQuestions, contentSlot, suggestionsSlot, reloadFn) {
    if (item.content && item.content.trim()) {
      contentSlot.appendChild(
        window.ContentFormatter.buildFormattedContent(item.content, { fontSize: "13px", marginBottom: "10px" })
      );
      item._textSourceWrapper = item._textSourceWrapper || { text: item.content };
      contentSlot.appendChild(buildFormatControls(item._textSourceWrapper));
    }

    // ---------- Notes ----------
    const notesTextarea = el("textarea", {
      placeholder: "Jot down a note from this lesson…",
      style: { border: "1px solid var(--line)", borderRadius: "10px", padding: "10px 12px", fontSize: "13px", minHeight: "60px", fontFamily: "inherit", width: "100%", resize: "vertical", marginTop: "12px" },
    });
    const saveNoteBtn = el("button", { className: "btn btn-secondary btn-sm", style: { marginTop: "6px" } }, [iconEl("list", 13, "var(--navy)", 2), " Save note"]);
    saveNoteBtn.onclick = async () => {
      if (!notesTextarea.value.trim()) { showToast("Write something first."); return; }
      try {
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ roadmapItemId: item.id, topic: item.title, noteText: notesTextarea.value.trim() }),
        });
        if (!res.ok) { showToast("Couldn't save that note."); return; }
        notesTextarea.value = "";
        showToast("Note saved — see the Notes tab.");
      } catch (e) { showToast("Couldn't reach the server."); }
    };
    contentSlot.appendChild(notesTextarea);
    contentSlot.appendChild(saveNoteBtn);

    // ---------- Quiz ----------
    if (item.status !== "done") {
      const quizSlot = el("div", { style: { marginTop: "16px" } });
      contentSlot.appendChild(el("div", { style: { display: "flex", alignItems: "center", gap: "8px", margin: "16px 0 10px" } }, [
        el("div", { style: { flex: "1", height: "1px", background: "var(--line)" } }),
        el("span", { className: "label-eyebrow" }, ["Lesson quiz"]),
        el("div", { style: { flex: "1", height: "1px", background: "var(--line)" } }),
      ]));
      contentSlot.appendChild(
        el("div", { style: { fontSize: "12.5px", color: "var(--ink-soft)", marginBottom: "12px" } }, [
          quizQuestions ? "Pass this quiz (2/3 or better) to mark this lesson complete and unlock the next one." : "Loading quiz…",
        ])
      );
      contentSlot.appendChild(quizSlot);

      if (quizQuestions && quizQuestions.length > 0) {
        buildInlineQuiz(item, quizQuestions, quizSlot, suggestionsSlot, reloadFn);
      } else {
        // Fallback: generate quiz on demand if not stored (older items)
        const genQuizBtn = el("button", { className: "btn btn-secondary btn-sm" }, [iconEl("clipboard-check", 13, "var(--navy)", 2), " Generate quiz"]);
        genQuizBtn.onclick = () => {
          genQuizBtn.disabled = true;
          genQuizBtn.textContent = "Generating…";
          fetch("/api/lesson-quiz/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ lessonContent: item.content, lessonTitle: item.title }),
          }).then(r => r.json()).then(data => {
            genQuizBtn.remove();
            if (data.questions) buildInlineQuiz(item, data.questions, quizSlot, suggestionsSlot, reloadFn);
            else quizSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, ["Couldn't generate quiz."]));
          }).catch(() => { quizSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, ["Couldn't reach the server."])); });
        };
        quizSlot.appendChild(genQuizBtn);
      }
    } else {
      contentSlot.appendChild(
        el("div", { className: "card-flat", style: { background: "var(--green-bg)", color: "var(--green)", fontSize: "13px", fontWeight: "700", marginTop: "12px" } }, [
          "✅ Lesson complete — quiz passed.",
        ])
      );
    }
  }

  function buildInlineQuiz(item, questions, quizSlot, suggestionsSlot, reloadFn) {
    clear(quizSlot);
    let current = 0;
    let score = 0;

    function renderQuestion() {
      clear(quizSlot);
      const q = questions[current];
      const card = el("div", { className: "card" }, [
        el("div", { className: "label-eyebrow", style: { marginBottom: "8px" } }, [`Question ${current + 1} of ${questions.length}`]),
        el("div", { style: { fontSize: "13.5px", fontWeight: "700", marginBottom: "12px" } }, [q.question]),
      ]);
      q.options.forEach((opt, i) => {
        card.appendChild(
          el("button", {
            className: "btn btn-secondary btn-sm",
            style: { display: "block", width: "100%", textAlign: "left", marginBottom: "6px" },
            onclick: () => answerQuestion(i, q),
          }, [opt])
        );
      });
      quizSlot.appendChild(card);
    }

    function answerQuestion(selectedIndex, q) {
      const correct = selectedIndex === q.correctIndex;
      if (correct) score++;
      clear(quizSlot);
      quizSlot.appendChild(
        el("div", { className: "card", style: { border: `1.5px solid ${correct ? "var(--green)" : "var(--practice)"}` } }, [
          el("div", { className: `pill ${correct ? "pill-green" : "pill-practice"}`, style: { marginBottom: "8px" } }, [correct ? "Correct ✓" : "Not quite"]),
          el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", marginBottom: "10px" } }, [
            `Correct answer: ${q.options[q.correctIndex]}`,
          ]),
          el("button", { className: "btn btn-primary btn-sm", onclick: () => { current++; current >= questions.length ? finishQuiz() : renderQuestion(); } },
            [current + 1 < questions.length ? "Next question" : "See result"]
          ),
        ])
      );
    }

    async function finishQuiz() {
      const passed = score >= Math.ceil(questions.length * 0.67);
      clear(quizSlot);

      const resultCard = el("div", { className: "card", style: { textAlign: "center", padding: "24px" } }, [
        el("div", { style: { fontSize: "32px", marginBottom: "8px" } }, [passed ? "🏅" : "📖"]),
        el("div", { style: { fontSize: "20px", fontWeight: "800", color: passed ? "var(--green)" : "var(--ink)" } }, [`${score}/${questions.length}`]),
        el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", marginTop: "4px" } }, [passed ? "Passed! This lesson is now complete." : "Not quite — review the lesson and try again."]),
      ]);

      if (!passed) {
        const retryBtn = el("button", { className: "btn btn-secondary btn-sm", style: { marginTop: "12px" }, onclick: () => { score = 0; current = 0; renderQuestion(); } }, ["Try again"]);
        resultCard.appendChild(retryBtn);
      }

      quizSlot.appendChild(resultCard);

      if (passed) {
        try {
          const res = await fetch("/api/lesson-quiz/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ roadmapItemId: item.id, score, total: questions.length, lessonPlanId: item.lesson_plan_id }),
          });
          const data = await res.json();
          if (data.certificate) {
            // Show certificate notification
            quizSlot.appendChild(
              el("div", { className: "card", style: { background: "var(--navy)", color: "#fff", textAlign: "center", padding: "24px", marginTop: "12px" } }, [
                el("div", { style: { fontSize: "32px", marginBottom: "8px" } }, ["🏆"]),
                el("div", { style: { fontSize: "18px", fontWeight: "800", marginBottom: "4px" } }, ["Certificate Earned!"]),
                el("div", { style: { fontSize: "13px", opacity: 0.8 } }, [`You completed the full "${data.certificate.lesson_plan_title}" learning path.`]),
                el("div", { style: { fontSize: "11px", opacity: 0.6, marginTop: "8px" } }, ["View it in the Analytics tab."]),
              ])
            );
          }
          // Show suggested next lessons
          if (suggestionsSlot) showSuggestions(item.title, suggestionsSlot);
          // Reload to unlock next lesson
          setTimeout(() => reloadFn && reloadFn(), 1500);
        } catch (e) {}
      }
    }

    renderQuestion();
  }

  async function showSuggestions(completedTopic, suggestionsSlot) {
    try {
      const res = await fetch("/api/roadmap/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ completedTopic }),
      });
      const data = await res.json();
      if (!res.ok || !data.suggestions || data.suggestions.length === 0) return;
      const card = el("div", { className: "card", style: { border: "1.5px solid var(--indigo)" } }, [
        el("div", { className: "row", style: { marginBottom: "10px" } }, [
          el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [
            iconEl("sparkles", 14, "var(--indigo)", 2),
            el("div", { style: { fontSize: "13px", fontWeight: "700", color: "var(--indigo-deep)" } }, ["What to study next"]),
          ]),
          el("button", { className: "icon-btn", onclick: () => clear(suggestionsSlot) }, [iconEl("circle-x", 14, "var(--ink-faint)", 1.5)]),
        ]),
      ]);
      data.suggestions.forEach(s => {
        card.appendChild(
          el("div", { className: "card-flat", style: { marginBottom: "6px" } }, [
            el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" } }, [
              el("div", null, [
                el("div", { style: { fontSize: "13.5px", fontWeight: "700" } }, [s.topic]),
                el("div", { style: { fontSize: "12px", color: "var(--ink-soft)", marginTop: "2px" } }, [s.reason]),
              ]),
              el("button", {
                className: "btn btn-secondary btn-sm",
                style: { flex: "0 0 auto" },
                onclick: () => { navigator.clipboard && navigator.clipboard.writeText(s.topic); showToast(`"${s.topic}" copied — paste it into the generator above.`); },
              }, ["Copy topic"]),
            ]),
          ])
        );
      });
      clear(suggestionsSlot);
      suggestionsSlot.appendChild(card);
    } catch (e) {}
  }

  // =====================================================================
  // NOTES TAB — embedded version of screen-notes.js content
  // =====================================================================
  function buildNotesTab() {
    const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "14px" } });
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
        listSlot.appendChild(emptyState("list", "No notes yet", "Read a lesson and jot a note — it'll appear here, tagged with the topic it came from."));
        return;
      }
      notes.forEach(note => {
        const date = new Date(note.created_at);
        listSlot.appendChild(
          el("div", { className: "card", style: { padding: "16px 18px" } }, [
            el("div", { className: "row", style: { marginBottom: "8px" } }, [
              el("span", { className: "pill pill-indigo" }, [note.topic]),
              el("span", { style: { fontSize: "11.5px", color: "var(--ink-faint)" } }, [date.toLocaleDateString(undefined, { month: "short", day: "numeric" })]),
            ]),
            el("div", { style: { fontSize: "13.5px", lineHeight: "1.5", whiteSpace: "pre-wrap" } }, [note.note_text]),
            el("div", { className: "row", style: { marginTop: "10px" } }, [
              el("span"),
              el("div", { style: { display: "flex", gap: "6px" } }, [
                el("button", {
                  className: "pill pill-gray pill-clickable",
                  onclick: () => { navigator.clipboard && navigator.clipboard.writeText(note.note_text); showToast("Copied"); },
                }, [iconEl("copy", 12, "var(--ink-soft)", 2), " Copy"]),
                el("button", {
                  className: "pill pill-gray pill-clickable",
                  onclick: async () => {
                    if (!confirm("Delete this note?")) return;
                    await fetch(`/api/notes/${note.id}`, { method: "DELETE", credentials: "include" });
                    loadNotes();
                  },
                }, [iconEl("circle-x", 12, "var(--red)", 2), " Delete"]),
              ]),
            ]),
          ])
        );
      });
    }

    loadNotes();
    return content;
  }

  // =====================================================================
  // ANALYTICS TAB — lesson progress + quiz log + certificates
  // =====================================================================
  function buildAnalyticsTab() {
    const content = el("div", { className: "content", style: { display: "flex", flexDirection: "column", gap: "18px" } });

    // Progress donut
    function svgEl(tag, attrs, children) {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.keys(attrs || {}).forEach(k => node.setAttribute(k, attrs[k]));
      (children || []).forEach(c => c && node.appendChild(c));
      return node;
    }

    function buildDonut(segments, size) {
      size = size || 180;
      const cx = size/2, cy = size/2, r = size/2-16, stroke = 22;
      const total = segments.reduce((a, s) => a + s.value, 0);
      const svg = svgEl("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
      if (total === 0) { svg.appendChild(svgEl("circle", { cx, cy, r, fill: "none", stroke: "#F0EEE7", "stroke-width": stroke })); return svg; }
      let angle = -90;
      const circ = 2 * Math.PI * r;
      segments.forEach(s => {
        if (s.value === 0) return;
        const frac = s.value / total;
        const len = frac * circ;
        const gap = segments.filter(x => x.value > 0).length > 1 ? 3 : 0;
        svg.appendChild(svgEl("circle", {
          cx, cy, r, fill: "none", stroke: s.color, "stroke-width": stroke,
          "stroke-dasharray": `${Math.max(len - gap, 0).toFixed(1)} ${(circ - len + gap).toFixed(1)}`,
          "stroke-linecap": gap ? "round" : "butt",
          transform: `rotate(${angle} ${cx} ${cy})`,
        }));
        angle += frac * 360;
      });
      const t = svgEl("text", { x: cx, y: cy - 3, "font-size": 24, "font-weight": 700, fill: "#2D2A27", "text-anchor": "middle" });
      t.textContent = String(total);
      const l = svgEl("text", { x: cx, y: cy + 15, "font-size": 10, fill: "#9A9FAC", "text-anchor": "middle" });
      l.textContent = "lessons";
      svg.appendChild(t); svg.appendChild(l);
      return svg;
    }

    // Progress section
    const progressSlot = el("div");
    content.appendChild(el("div", { className: "label-eyebrow" }, ["Lesson progress"]));
    content.appendChild(progressSlot);

    // Quiz log section
    content.appendChild(el("div", { className: "label-eyebrow" }, ["Quiz history"]));
    const quizLogSlot = el("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } });
    content.appendChild(quizLogSlot);

    // Certificates section
    content.appendChild(el("div", { className: "label-eyebrow" }, ["Certificates"]));
    const certsSlot = el("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } });
    content.appendChild(certsSlot);

    // Load all data
    (async () => {
      try {
        const [analyticsRes, quizRes, certsRes] = await Promise.all([
          fetch("/api/analytics", { credentials: "include" }),
          fetch("/api/quiz-log", { credentials: "include" }),
          fetch("/api/certificates", { credentials: "include" }),
        ]);
        const analytics = await analyticsRes.json();
        const quizData = await quizRes.json();
        const certsData = await certsRes.json();

        // Render progress
        const counts = analytics.counts || { not_started: 0, in_progress: 0, done: 0, overdue: 0 };
        const segments = [
          { label: "Not started", value: counts.not_started, color: "#9A9FAC" },
          { label: "In progress", value: counts.in_progress, color: "#F2C94C" },
          { label: "Done", value: counts.done, color: "#8FD19E" },
        ];
        if ((counts.not_started + counts.in_progress + counts.done) === 0) {
          progressSlot.appendChild(emptyState("chart-bar", "No lessons yet", "Save a learning path to see your progress here."));
        } else {
          const row = el("div", { style: { display: "flex", gap: "24px", alignItems: "center", flexWrap: "wrap" } });
          const numCards = el("div", { style: { display: "flex", flexDirection: "column", gap: "8px", flex: "0 0 180px" } });
          segments.forEach(s => {
            numCards.appendChild(
              el("div", { className: "card", style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px" } }, [
                el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [
                  el("span", { style: { width: "10px", height: "10px", borderRadius: "3px", background: s.color, display: "inline-block" } }),
                  el("span", { style: { fontSize: "13px", fontWeight: "600" } }, [s.label]),
                ]),
                el("span", { style: { fontSize: "18px", fontWeight: "700" } }, [String(s.value)]),
              ])
            );
          });
          if (counts.overdue > 0) {
            numCards.appendChild(
              el("div", { className: "card", style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "var(--red-bg)", border: "1px solid var(--red)" } }, [
                el("span", { style: { fontSize: "13px", fontWeight: "600", color: "var(--red)" } }, ["Overdue"]),
                el("span", { style: { fontSize: "18px", fontWeight: "700", color: "var(--red)" } }, [String(counts.overdue)]),
              ])
            );
          }
          row.appendChild(numCards);
          row.appendChild(el("div", { className: "card", style: { padding: "20px" } }, [buildDonut(segments)]));
          progressSlot.appendChild(row);
        }

        // Render quiz log
        const attempts = quizData.attempts || [];
        if (attempts.length === 0) {
          quizLogSlot.appendChild(el("div", { className: "card-flat", style: { fontSize: "12.5px", color: "var(--ink-faint)" } }, ["No quiz attempts yet — complete a lesson quiz to see your history here."]));
        } else {
          attempts.slice(0, 20).forEach(a => {
            const passed = a.score >= Math.ceil(a.total * 0.67);
            const pct = Math.round((a.score / a.total) * 100);
            const date = new Date(a.created_at);
            quizLogSlot.appendChild(
              el("div", { className: "card", style: { display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px" } }, [
                el("div", { style: { width: "40px", height: "40px", borderRadius: "10px", background: passed ? "var(--green-bg)" : "var(--red-bg)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 40px" } }, [
                  el("span", { style: { fontSize: "14px" } }, [passed ? "✅" : "❌"]),
                ]),
                el("div", { style: { flex: "1", minWidth: "0" } }, [
                  el("div", { style: { fontSize: "13px", fontWeight: "700", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, [a.lesson_title]),
                  el("div", { style: { fontSize: "11.5px", color: "var(--ink-faint)", marginTop: "2px" } }, [
                    date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                  ]),
                ]),
                el("div", { style: { textAlign: "right" } }, [
                  el("div", { style: { fontSize: "16px", fontWeight: "800", color: passed ? "var(--green)" : "var(--red)" } }, [`${a.score}/${a.total}`]),
                  el("div", { style: { fontSize: "11px", color: "var(--ink-faint)" } }, [`${pct}%`]),
                ]),
              ])
            );
          });
        }

        // Render certificates
        const certs = certsData.certificates || [];
        if (certs.length === 0) {
          certsSlot.appendChild(el("div", { className: "card-flat", style: { fontSize: "12.5px", color: "var(--ink-faint)" } }, ["Complete all lessons in a learning path to earn your first certificate."]));
        } else {
          certs.forEach(cert => {
            const date = new Date(cert.earned_at);
            certsSlot.appendChild(
              el("div", { className: "card", style: { background: "var(--navy)", color: "#fff", display: "flex", alignItems: "center", gap: "16px", padding: "20px 24px" } }, [
                el("div", { style: { fontSize: "36px" } }, ["🏆"]),
                el("div", null, [
                  el("div", { style: { fontSize: "11px", opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" } }, ["Certificate of Completion"]),
                  el("div", { style: { fontSize: "16px", fontWeight: "800" } }, [cert.lesson_plan_title]),
                  el("div", { style: { fontSize: "12px", opacity: 0.7, marginTop: "4px" } }, [
                    `Earned ${date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`,
                  ]),
                ]),
              ])
            );
          });
        }
      } catch (e) {
        progressSlot.appendChild(el("div", { style: { fontSize: 13, color: "var(--red)" } }, ["Couldn't load analytics."]));
      }
    })();

    return content;
  }

  renderTopbar();
  renderBody();
  return container;
}

window.ScreenRoadmap = { buildRoadmapScreen };

})();
