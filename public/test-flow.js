(function(){
const { el, iconEl, clear } = window.DOMHelpers;
const { showToast } = window.UIShared;

// A self-contained quiz-taking flow: format choice -> topic -> generate
// -> answer questions one at a time -> score -> summary. Not part of
// the generic conversation engine since quiz state (current question,
// running score, per-question results) doesn't fit the chat-message
// model the other modes use.
function buildTestFlow(onExit) {
  const container = el("div", { style: { display: "flex", flexDirection: "column", gap: "18px", maxWidth: "640px", margin: "0 auto", width: "100%" } });

  let format = null; // 'mcq' | 'open'
  let quiz = null;
  let currentIndex = 0;
  let results = []; // { correct?: bool, score?: number, feedback?: string }
  let mcqSelected = null;
  let openAnswerText = "";

  function renderSetup() {
    clear(container);
    container.appendChild(
      el("div", { style: { textAlign: "center" } }, [
        el("div", { style: { fontSize: "20px", fontWeight: "700", marginBottom: "6px" } }, ["Test mode"]),
        el("div", { style: { fontSize: "13.5px", color: "var(--ink-soft)" } }, ["Pick a format and a topic to get quizzed."]),
      ])
    );

    const formatRow = el("div", { style: { display: "flex", gap: "12px" } });
    function renderFormatRow() {
      clear(formatRow);
      [
        { id: "mcq", label: "Multiple choice", icon: "checklist", desc: "4 options, instant scoring" },
        { id: "open", label: "Open response", icon: "message-2", desc: "Write your answer, AI scores it" },
      ].forEach(f => {
        formatRow.appendChild(
          el("button", {
            className: "mode-tile",
            style: { flex: "1", border: format === f.id ? "1.5px solid var(--indigo)" : "1px solid var(--line)" },
            onclick: () => { format = f.id; renderFormatRow(); },
          }, [
            el("div", { className: "ic-wrap", style: { background: "var(--sage-bg)" } }, [iconEl(f.icon, 19, "var(--sage-deep)")]),
            el("div", { className: "title" }, [f.label]),
            el("div", { className: "desc" }, [f.desc]),
          ])
        );
      });
    }
    renderFormatRow();
    container.appendChild(formatRow);

    const topicInput = el("input", {
      placeholder: "Topic, e.g. \"Objection handling\" or \"Discovery for healthcare accounts\"",
      style: { border: "1px solid var(--line)", borderRadius: "10px", padding: "12px 14px", fontSize: "13.5px" },
    });
    container.appendChild(topicInput);

    const startBtn = el("button", { className: "btn btn-primary" }, ["Start test"]);
    startBtn.onclick = () => {
      if (!format) { showToast("Pick a format first."); return; }
      if (!topicInput.value.trim()) { showToast("Add a topic first."); return; }
      generateQuiz(topicInput.value.trim());
    };
    container.appendChild(startBtn);

    if (onExit) {
      container.appendChild(el("button", { className: "btn btn-ghost", onclick: onExit }, ["Back to Home"]));
    }
  }

  async function generateQuiz(topic) {
    clear(container);
    container.appendChild(
      el("div", { className: "card-flat", style: { display: "flex", gap: 10, alignItems: "center" } }, [
        el("div", { className: "typing-dots" }, [el("span"), el("span"), el("span")]),
        el("span", { style: { fontSize: 13 } }, ["Building your test…"]),
      ])
    );
    try {
      const res = await fetch("/api/test/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ topic, format }),
      });
      const data = await res.json();
      if (!res.ok) {
        clear(container);
        container.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, [data.error || "Couldn't generate a test."]));
        container.appendChild(el("button", { className: "btn btn-secondary", style: { marginTop: 10 }, onclick: renderSetup }, ["Try again"]));
        return;
      }
      quiz = data;
      currentIndex = 0;
      results = [];
      renderQuestion();
    } catch (e) {
      clear(container);
      container.appendChild(el("div", { className: "card-flat", style: { background: "var(--red-bg)", color: "var(--red)", fontSize: 13 } }, ["Couldn't reach the server."]));
    }
  }

  function renderQuestion() {
    clear(container);
    mcqSelected = null;
    openAnswerText = "";

    const q = quiz.questions[currentIndex];

    container.appendChild(
      el("div", { className: "row" }, [
        el("div", { className: "label-eyebrow" }, [`Question ${currentIndex + 1} of ${quiz.questions.length}`]),
        el("span", { className: "pill pill-gray" }, [quiz.title]),
      ])
    );
    container.appendChild(
      el("div", { className: "progress-track" }, [
        el("div", { className: "progress-fill", style: { width: `${(currentIndex / quiz.questions.length) * 100}%`, background: "var(--sage)" } }),
      ])
    );

    container.appendChild(
      el("div", { className: "card" }, [
        el("div", { className: "pill pill-sage", style: { marginBottom: "12px" } }, ["Scenario"]),
        el("div", { style: { fontSize: "15px", fontWeight: "700", lineHeight: "1.5" } }, [q.question]),
      ])
    );

    const answerSlot = el("div");
    container.appendChild(answerSlot);

    if (format === "mcq") {
      function renderOptions() {
        clear(answerSlot);
        q.options.forEach((opt, i) => {
          answerSlot.appendChild(
            el("div", {
              className: "card-flat",
              style: { padding: "13px 14px", marginBottom: "8px", cursor: "pointer", border: mcqSelected === i ? "1.5px solid var(--indigo)" : "none" },
              onclick: () => { mcqSelected = i; renderOptions(); },
            }, [opt])
          );
        });
      }
      renderOptions();
      const submitBtn = el("button", { className: "btn btn-primary", style: { marginTop: "10px" } }, ["Submit answer"]);
      submitBtn.onclick = () => { if (mcqSelected != null) submitMcqAnswer(q); else showToast("Pick an answer first."); };
      container.appendChild(submitBtn);
    } else {
      const textarea = el("textarea", {
        placeholder: "Write your answer here…",
        style: { border: "1px solid var(--line)", borderRadius: "10px", padding: "12px 14px", fontSize: "13.5px", minHeight: "100px", fontFamily: "inherit", width: "100%", resize: "vertical" },
        oninput: (e) => { openAnswerText = e.target.value; },
      });
      answerSlot.appendChild(textarea);
      const submitBtn = el("button", { className: "btn btn-primary", style: { marginTop: "10px" } }, ["Submit answer"]);
      submitBtn.onclick = () => {
        if (!openAnswerText.trim()) { showToast("Write an answer first."); return; }
        submitOpenAnswer(q);
      };
      container.appendChild(submitBtn);
    }
  }

  function submitMcqAnswer(q) {
    const correct = mcqSelected === q.correctIndex;
    results.push({ correct, selected: mcqSelected });
    renderMcqFeedback(q, correct);
  }

  function renderMcqFeedback(q, correct) {
    clear(container);
    container.appendChild(
      el("div", { className: "card", style: { border: correct ? "1.5px solid var(--green)" : "1.5px solid var(--practice)" } }, [
        el("div", { className: `pill ${correct ? "pill-green" : "pill-practice"}`, style: { marginBottom: "10px" } }, [correct ? "Correct" : "Not quite"]),
        el("div", { style: { fontSize: "14px", fontWeight: "600", marginBottom: "8px" } }, [q.question]),
        window.ContentFormatter.buildFormattedContent(q.explanation, { fontSize: "13px", color: "var(--ink-soft)", lineHeight: "1.5" }),
      ])
    );
    const nextBtn = el("button", { className: "btn btn-primary", style: { marginTop: "14px" } }, [currentIndex + 1 < quiz.questions.length ? "Next question" : "See results"]);
    nextBtn.onclick = () => {
      currentIndex++;
      if (currentIndex >= quiz.questions.length) renderSummary();
      else renderQuestion();
    };
    container.appendChild(nextBtn);
  }

  async function submitOpenAnswer(q) {
    clear(container);
    container.appendChild(
      el("div", { className: "card-flat", style: { display: "flex", gap: 10, alignItems: "center" } }, [
        el("div", { className: "typing-dots" }, [el("span"), el("span"), el("span")]),
        el("span", { style: { fontSize: 13 } }, ["Scoring your answer…"]),
      ])
    );
    try {
      const res = await fetch("/api/test/score-open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ question: q.question, idealAnswerNotes: q.idealAnswerNotes, answer: openAnswerText }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Couldn't score that answer.");
        results.push({ score: 0, feedback: "Scoring failed — not counted against you." });
        renderOpenFeedback(q, results[results.length - 1]);
        return;
      }
      results.push({ score: data.score, feedback: data.feedback });
      renderOpenFeedback(q, data);
    } catch (e) {
      results.push({ score: 0, feedback: "Couldn't reach the server — not counted against you." });
      renderOpenFeedback(q, results[results.length - 1]);
    }
  }

  function renderOpenFeedback(q, scoreData) {
    clear(container);
    container.appendChild(
      el("div", { className: "card" }, [
        el("div", { className: "row", style: { marginBottom: "10px" } }, [
          el("span", { className: "pill pill-indigo" }, [`Score: ${scoreData.score} / 5`]),
        ]),
        el("div", { style: { fontSize: "14px", fontWeight: "600", marginBottom: "8px" } }, [q.question]),
        window.ContentFormatter.buildFormattedContent(scoreData.feedback, { fontSize: "13px", color: "var(--ink-soft)", lineHeight: "1.5" }),
      ])
    );
    const nextBtn = el("button", { className: "btn btn-primary", style: { marginTop: "14px" } }, [currentIndex + 1 < quiz.questions.length ? "Next question" : "See results"]);
    nextBtn.onclick = () => {
      currentIndex++;
      if (currentIndex >= quiz.questions.length) renderSummary();
      else renderQuestion();
    };
    container.appendChild(nextBtn);
  }

  function renderSummary() {
    clear(container);
    let scoreLine;
    if (format === "mcq") {
      const correctCount = results.filter(r => r.correct).length;
      scoreLine = `${correctCount} / ${results.length} correct`;
    } else {
      const total = results.reduce((sum, r) => sum + r.score, 0);
      scoreLine = `${total} / ${results.length * 5} points`;
    }

    container.appendChild(
      el("div", { className: "card", style: { textAlign: "center", padding: "32px 24px" } }, [
        iconEl("award", 28, "var(--amber)", 1.6),
        el("div", { style: { fontSize: "20px", fontWeight: "700", marginTop: "12px" } }, [scoreLine]),
        el("div", { style: { fontSize: "13px", color: "var(--ink-soft)", marginTop: "4px" } }, [quiz.title]),
      ])
    );

    const retryBtn = el("button", { className: "btn btn-primary", style: { marginTop: "14px" } }, ["Take another test"]);
    retryBtn.onclick = () => { quiz = null; format = null; renderSetup(); };
    container.appendChild(retryBtn);

    if (onExit) {
      container.appendChild(el("button", { className: "btn btn-ghost", style: { marginTop: "8px" }, onclick: onExit }, ["Back to Home"]));
    }
  }

  renderSetup();
  return container;
}

window.TestFlow = { buildTestFlow };

})();
