(() => {
  const forms = [...document.querySelectorAll("[data-auth-form]")];
  const accountCard = document.querySelector("[data-account-card]");
  const logoutButtons = [...document.querySelectorAll("[data-logout]")];

  async function readJson(response) {
    const type = response.headers.get("content-type") || "";
    return type.includes("application/json") ? response.json().catch(() => ({})) : {};
  }

  function safeNext() {
    const next = new URLSearchParams(location.search).get("next") || "dashboard.html";
    return /^[a-z0-9][a-z0-9./?=&_-]*$/i.test(next) && !next.includes("://") ? next : "dashboard.html";
  }

  forms.forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const mode = form.dataset.authForm;
      const message = form.querySelector("[data-auth-message]");
      const button = form.querySelector('button[type="submit"]');
      const password = form.elements.password?.value || "";
      if (mode === "register" && password !== (form.elements.confirmPassword?.value || "")) {
        message.textContent = "Those passwords do not match.";
        message.dataset.state = "error";
        return;
      }
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      message.textContent = mode === "register" ? "Creating your secure account…" : "Signing you in…";
      message.dataset.state = "loading";
      try {
        const response = await fetch(`/api/auth/${mode}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email: form.elements.email.value.trim(), password })
        });
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || "We could not complete that request.");
        message.textContent = "You’re in — opening your account…";
        message.dataset.state = "success";
        location.assign(safeNext());
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : "Something went wrong. Please try again.";
        message.dataset.state = "error";
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    });
  });

  async function loadAccount() {
    if (!accountCard) return;
    try {
      const response = await fetch("/api/me", { credentials: "same-origin", headers: { Accept: "application/json" } });
      const data = await readJson(response);
      if (!response.ok || !data.authenticated) {
        location.assign(`login.html?next=${encodeURIComponent(location.pathname.split("/").pop() || "dashboard.html")}`);
        return;
      }
      const subscription = data.subscription;
      const premium = Number(subscription?.premium || 0) === 1;
      accountCard.innerHTML = `
        <div class="account-summary">
          <span class="status-pill ${premium ? "success" : ""}">${premium ? "Premium active" : "Free account"}</span>
          <h2>Welcome back</h2>
          <p class="account-email">${escapeHtml(data.user.email)}</p>
          <div class="account-actions">
            <a class="btn" href="complaint-hub.html">Start a complaint</a>
            <a class="btn secondary" href="subscription-and-billing.html">${premium ? "Manage Premium" : "Try Premium free"}</a>
          </div>
        </div>`;
    } catch {
      accountCard.innerHTML = '<div class="notice danger">We could not load your account. Refresh the page and try again.</div>';
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  logoutButtons.forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => null);
    location.assign("index.html");
  }));

  loadAccount();
})();
