// =====================================================================
// AI CONNECTION (client side)
//
// This file no longer holds an API key or the system prompt — those
// now live on the server (see server/server.js), so they can never be
// viewed by opening the browser's developer tools. This file just
// calls the server's /api/chat route and passes back whatever it says.
// =====================================================================

async function callGemini(history, dealContext) {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ messages: history, dealContext: dealContext || null }),
    });

    if (res.status === 401) {
      return { error: true, text: "You're signed out. Refresh the page and sign in again." };
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: true, text: body.error || `Something went wrong talking to the server (status ${res.status}).` };
    }

    const data = await res.json();
    return { error: false, text: data.text };
  } catch (e) {
    console.error("Network error calling /api/chat:", e);
    return { error: true, text: "Couldn't reach the server — check your internet connection and try again." };
  }
}

window.callGemini = callGemini;
