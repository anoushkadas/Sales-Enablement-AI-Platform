(function(){
const { el, mount } = window.DOMHelpers;
const { buildSidebar } = window.UIShared;
const { createConversation } = window.ConversationShared;

function renderApp(userEmail) {
  document.body.innerHTML = "";
  const shell = el("div", { className: "app-shell" });
  const sidebarSlot = el("div");
  const mainSlot = el("div", { className: "main" });
  shell.appendChild(sidebarSlot);
  shell.appendChild(mainSlot);
  document.body.appendChild(shell);

  let active = "home";
  const homeConv = createConversation(null);

  function renderSidebar() {
    mount(sidebarSlot, buildSidebar(active, handleNavigate, userEmail, handleSignOut));
  }

  function renderScreen() {
    let screenNode;
    if (active === "home") {
      screenNode = window.ScreenHome.buildHomeScreen(homeConv, window.UIShared.showToast, userEmail);
    } else if (active === "deals") {
      screenNode = window.ScreenDeals.buildDealsScreen(handleOpenInCoach);
    } else if (active === "roadmap") {
      screenNode = window.ScreenRoadmap.buildRoadmapScreen();
    } else if (active === "history") {
      screenNode = window.ScreenHistory.buildHistoryScreen();
    } else if (active === "analytics") {
      screenNode = window.ScreenAnalytics.buildAnalyticsScreen();
    } else if (active === "knowledge") {
      screenNode = window.ScreenKnowledge.buildKnowledgeScreen();
    }
    mount(mainSlot, screenNode);
  }

  function handleNavigate(id, opts) {
    if (id === "home" && opts && opts.newChat) {
      homeConv.reset();
    }
    active = id;
    renderSidebar();
    renderScreen();
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
}

async function boot() {
  const existingEmail = await window.AuthGate.checkExistingSession();
  if (existingEmail) {
    renderApp(existingEmail);
    return;
  }
  const signInScreen = window.AuthGate.buildSignInScreen((email) => {
    renderApp(email);
  });
  document.body.innerHTML = "";
  document.body.appendChild(signInScreen);
}

document.addEventListener("DOMContentLoaded", boot);

})();
