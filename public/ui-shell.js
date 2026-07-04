(function(){
const { el, iconEl, clear } = window.DOMHelpers;

function buildSidebar(active, onNavigate, userEmail, onSignOut, userRole, dealCount) {
  const items = [
    { id: "home", label: "Home", icon: "home" },
    { id: "deals", label: "Active deals", icon: "briefcase", count: dealCount != null ? dealCount : null },
    { id: "generate", label: "Generate", icon: "layers" },
    { id: "callanalysis", label: "Call analysis", icon: "headset" },
    { id: "roadmap", label: "Learning roadmap", icon: "map" },
    { id: "history", label: "History & lookups", icon: "clock" },
    { id: "knowledge", label: "Knowledge", icon: "file-text" },
  ];
  if (userRole === "manager") {
    items.push({ id: "manager", label: "Manage team", icon: "briefcase" });
  }

  function initialsFromEmail(email) {
    if (!email) return "?";
    const local = email.split("@")[0];
    const parts = local.split(/[._]/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return local.slice(0, 2).toUpperCase();
  }

  return el("div", { className: "sidebar" }, [
    el("div", { className: "sb-brand" }, [
      el("div", { className: "mark" }, [iconEl("sparkles", 16, "#fff", 2)]),
      el("div", { className: "name" }, ["Sales Companion"]),
    ]),
    el("button", { className: "sb-newchat", onclick: () => onNavigate("home", { newChat: true }) }, [
      iconEl("plus", 16, "#fff", 2),
      el("span", null, ["New conversation"]),
    ]),
    el("div", { className: "sb-section" }, ["Workspace"]),
    ...items.map(it =>
      el("button", { className: `sb-item ${it.id === active ? "active" : ""}`, onclick: () => onNavigate(it.id) }, [
        iconEl(it.icon, 18, it.id === active ? "#fff" : "rgba(255,255,255,0.6)", 1.8),
        el("span", null, [it.label]),
        it.count != null ? el("span", { className: "count" }, [String(it.count)]) : null,
      ])
    ),
    el("div", { className: "sb-spacer" }),
    el("button", {
      className: "sb-user",
      style: { width: "100%", border: "none", background: "none", cursor: "pointer", textAlign: "left" },
      onclick: onSignOut,
      title: "Sign out",
    }, [
      el("div", { className: "avatar" }, [initialsFromEmail(userEmail)]),
      el("div", { className: "info" }, [
        el("div", { className: "name" }, [userEmail || "Signed in"]),
        el("div", { className: "role" }, ["Sign out"]),
      ]),
    ]),
  ]);
}

function buildTopbar(title, sub, rightChildren) {
  return el("div", { className: "topbar" }, [
    el("div", null, [
      el("h1", null, [title]),
      sub ? el("div", { className: "sub" }, [sub]) : null,
    ]),
    el("div", { className: "topbar-actions" }, rightChildren || []),
  ]);
}

let toastTimer = null;
function showToast(message) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = el("div", { id: "toast-container" });
    document.body.appendChild(container);
  }
  clear(container);
  container.appendChild(
    el("div", { className: "toast" }, [iconEl("circle-check", 16, "#fff", 2), message])
  );
  container.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { container.style.display = "none"; }, 2400);
}

window.UIShared = { buildSidebar, buildTopbar, showToast };

})();
