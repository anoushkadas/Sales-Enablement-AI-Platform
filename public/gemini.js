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
    return { error: true, text: "Couldn't reach the server — check your connection and try again." };
  }
}

window.callGemini = callGemini;
