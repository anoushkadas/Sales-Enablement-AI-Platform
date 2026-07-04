const GOOGLE_CLIENT_ID = "339771370248-uckaljn92bqtha96tdbt0uqeaq2fqu1n.apps.googleusercontent.com";

(function () {
  const { el } = window.DOMHelpers;

  function loadGoogleScript() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) return resolve();
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load Google's sign-in script. Check your internet connection."));
      document.head.appendChild(script);
    });
  }

  async function checkExistingSession() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      const data = await res.json();
      return data.signedIn ? { email: data.email, role: data.role || "rep" } : null;
    } catch (e) {
      return null;
    }
  }

  function buildSignInScreen(onSignedIn) {
    const errorBox = el("div", {
      style: {
        display: "none",
        background: "var(--red-bg)",
        color: "var(--red)",
        padding: "12px 16px",
        borderRadius: "10px",
        fontSize: "13px",
        marginTop: "16px",
        maxWidth: "360px",
        textAlign: "center",
      },
    });

    const buttonSlot = el("div", { style: { marginTop: "24px", display: "flex", justifyContent: "center" } });

    const screen = el("div", {
      style: {
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--navy)",
        gap: "6px",
        padding: "24px",
      },
    }, [
      el("div", {
        style: { width: "48px", height: "48px", borderRadius: "14px", background: "var(--indigo)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "8px" },
      }, [window.icon ? el("span", { html: window.icon("sparkles", 22, "#fff", 2) }) : null]),
      el("div", { style: { color: "#fff", fontSize: "22px", fontWeight: "700" } }, ["Sales Companion"]),
      el("div", { style: { color: "rgba(255,255,255,0.6)", fontSize: "14px", marginBottom: "8px" } }, ["Sign in with your Google account to continue"]),
      buttonSlot,
      errorBox,
    ]);

    function showError(msg) {
      errorBox.textContent = msg;
      errorBox.style.display = "block";
    }

    loadGoogleScript()
      .then(() => {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response) => {
            try {
              const res = await fetch("/api/auth/google", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ idToken: response.credential }),
              });
              const data = await res.json();
              if (!res.ok) {
                showError(data.error || "Sign-in failed. Try again.");
                return;
              }
              onSignedIn({ email: data.email, role: data.role || "rep" });
            } catch (e) {
              showError("Couldn't reach the server. Try again in a moment.");
            }
          },
        });
        window.google.accounts.id.renderButton(buttonSlot, { theme: "filled_blue", size: "large", text: "signin_with" });
      })
      .catch((e) => showError(e.message));

    return screen;
  }

  window.AuthGate = { checkExistingSession, buildSignInScreen };
})();
