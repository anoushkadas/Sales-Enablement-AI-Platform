(function(){
const { el, mount } = window.DOMHelpers;
const { buildSidebar } = window.UIShared;
const { createConversation } = window.ConversationShared;

function renderApp(user) {
  const userEmail = user.email;
  const userRole = user.role || "rep";

  document.body.innerHTML = "";
  const shell = el("div", { className: "app-shell" });
  const sidebarSlot = el("div");
  const mainSlot = el("div", { className: "main" });
  shell.appendChild(sidebarSlot);
  shell.appendChild(mainSlot);
  document.body.appendChild(shell);

  let active = "home";
  let dealCount = null;
  const homeConv = createConversation(null);

  async function refreshDealCount() {
    try {
      const res = await fetch("/api/deals", { credentials: "include" });
      const data = await res.json();
      dealCount = (data.deals || []).length;
      renderSidebar();
    } catch (e) {
      // Non-critical — sidebar just won't show a count badge.
    }
  }

  function renderSidebar() {
    mount(sidebarSlot, buildSidebar(active, handleNavigate, userEmail, handleSignOut, userRole, dealCount));
  }

  function renderScreen() {
    let screenNode;
    if (active === "home") {
      screenNode = window.ScreenHome.buildHomeScreen(homeConv, window.UIShared.showToast, userEmail);
    } else if (active === "deals") {
      screenNode = window.ScreenDeals.buildDealsScreen(handleOpenInCoach);
    } else if (active === "roadmap") {
      screenNode = window.ScreenRoadmap.buildRoadmapScreen();
    } else if (active === "notes") {
      screenNode = window.ScreenNotes.buildNotesScreen();
    } else if (active === "history") {
      screenNode = window.ScreenHistory.buildHistoryScreen();
    } else if (active === "analytics") {
      screenNode = window.ScreenAnalytics.buildAnalyticsScreen();
    } else if (active === "knowledge") {
      screenNode = window.ScreenKnowledge.buildKnowledgeScreen();
    } else if (active === "generate") {
      screenNode = window.ScreenGenerate.buildGenerateScreen();
    } else if (active === "callanalysis") {
      screenNode = window.ScreenCallAnalysis.buildCallAnalysisScreen();
    } else if (active === "manager") {
      if (userRole !== "manager") {
        active = "home";
        screenNode = window.ScreenHome.buildHomeScreen(homeConv, window.UIShared.showToast, userEmail);
      } else {
        screenNode = window.ScreenManager.buildManagerScreen();
      }
    }
    mount(mainSlot, screenNode);
  }

  function handleNavigate(id, opts) {
    if (id === "home" && opts && opts.newChat) {
      homeConv.reset();
    }
    const leavingDeals = active === "deals" && id !== "deals";
    active = id;
    renderSidebar();
    renderScreen();
    if (leavingDeals) refreshDealCount();
  }

  function handleOpenInCoach(deal) {
    homeConv.reset(deal);
    homeConv.send(`Help me prep for my next conversation with ${deal.name}.`);
    active = "home";
    renderSidebar();
    renderScreen();
  }

  async function handleSignOut() {
    if (!confirm("Sign out of Sales Companion?")) return;
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (e) {}
    location.reload();
  }

  renderSidebar();
  renderScreen();
  refreshDealCount();
}

async function boot() {
  const existingUser = await window.AuthGate.checkExistingSession();
  if (existingUser) {
    renderApp(existingUser);
    return;
  }
  const signInScreen = window.AuthGate.buildSignInScreen((user) => {
    renderApp(user);
  });
  document.body.innerHTML = "";
  document.body.appendChild(signInScreen);
}

document.addEventListener("DOMContentLoaded", boot);

})();
