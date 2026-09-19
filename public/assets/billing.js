(() => {
  const startButtons = [...document.querySelectorAll("[data-start-trial]")];
  const message = document.querySelector("[data-billing-message]");
  const billingCard = document.querySelector("[data-billing-card]");
  let stripeReady = false;

  async function readJson(response) {
    const type = response.headers.get("content-type") || "";
    return type.includes("application/json") ? response.json().catch(() => ({})) : {};
  }

  function setMessage(text, state = "") {
    if (!message) return;
    message.textContent = text;
    message.dataset.state = state;
  }

  async function checkBillingHealth() {
    if (!startButtons.length) return;
    startButtons.forEach((button) => { button.disabled = true; });
    try {
      const response = await fetch("/api/health", { credentials: "same-origin", headers: { Accept: "application/json" } });
      const data = await readJson(response);
      stripeReady = Boolean(response.ok && data.stripe_checkout_configured && data.stripe_webhook_configured);
      startButtons.forEach((button) => { button.disabled = !stripeReady; });
      if (!stripeReady) setMessage("Premium checkout is being prepared and is not accepting payments yet.", "error");
    } catch {
      setMessage("We could not check billing availability. Please try again shortly.", "error");
    }
  }

  async function startTrial() {
    if (!stripeReady) return;
    const button = this;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    setMessage("Opening secure Stripe Checkout…", "loading");
    try {
      const response = await fetch("/api/billing/create-checkout-session", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
      const data = await readJson(response);
      if (response.status === 401) {
        location.assign(`login.html?next=${encodeURIComponent(location.pathname.split("/").pop() || "checkout.html")}`);
        return;
      }
      if (!response.ok) throw new Error(data.error || "Unable to start checkout.");
      if (!/^https:\/\/checkout\.stripe\.com\//i.test(data.checkoutUrl || "")) throw new Error("Stripe did not return a valid checkout link.");
      location.assign(data.checkoutUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start checkout.", "error");
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  startButtons.forEach((button) => button.addEventListener("click", startTrial));

  async function loadBilling() {
    if (!billingCard) return;
    try {
      const response = await fetch("/api/me", { credentials: "same-origin", headers: { Accept: "application/json" } });
      const data = await readJson(response);
      if (!response.ok || !data.authenticated) {
        location.assign("login.html?next=subscription-and-billing.html");
        return;
      }
      const sub = data.subscription;
      if (!sub) {
        billingCard.innerHTML = `
          <span class="status-pill">Free account</span>
          <h2>Premium is ready when you are</h2>
          <p>Start with 14 days free, then £5 per month. Cancel any time through Stripe.</p>
          <button class="btn" type="button" data-start-trial>Start 14-day free trial</button>
          <p class="form-message" data-billing-message role="status"></p>`;
        const button = billingCard.querySelector("[data-start-trial]");
        button.addEventListener("click", startTrial);
        startButtons.push(button);
        await checkBillingHealth();
        return;
      }
      const rawDate = sub.trial_end || sub.current_period_end;
      const date = rawDate ? new Date(Number(rawDate) * 1000) : null;
      const dateText = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
      const active = Number(sub.premium || 0) === 1;
      billingCard.innerHTML = `
        <span class="status-pill ${active ? "success" : ""}">${active ? "Premium active" : "Subscription inactive"}</span>
        <h2>Disputr Premium</h2>
        <div class="billing-facts">
          <div><span>Status</span><strong>${String(sub.status || "unknown").replaceAll("_", " ")}</strong></div>
          <div><span>Price</span><strong>£5 monthly</strong></div>
          ${dateText ? `<div><span>${sub.status === "trialing" ? "Trial ends" : "Next billing date"}</span><strong>${dateText}</strong></div>` : ""}
        </div>
        <p>${sub.cancel_at_period_end ? "Your plan will end at the close of the current billing period." : "Your plan renews monthly unless you cancel."}</p>
        <button class="btn secondary" type="button" data-open-portal>Manage payment or cancel</button>
        <p class="form-message" data-portal-message role="status"></p>`;
      const portalButton = billingCard.querySelector("[data-open-portal]");
      const portalMessage = billingCard.querySelector("[data-portal-message]");
      portalButton.addEventListener("click", async () => {
        portalButton.disabled = true;
        portalMessage.textContent = "Opening Stripe’s secure billing portal…";
        try {
          const portalResponse = await fetch("/api/billing/create-portal-session", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
          const payload = await readJson(portalResponse);
          if (!portalResponse.ok) throw new Error(payload.error || "Unable to open billing.");
          if (!/^https:\/\/billing\.stripe\.com\//i.test(payload.portalUrl || "")) throw new Error("Stripe did not return a valid billing link.");
          location.assign(payload.portalUrl);
        } catch (error) {
          portalMessage.textContent = error instanceof Error ? error.message : "Unable to open billing.";
          portalMessage.dataset.state = "error";
          portalButton.disabled = false;
        }
      });
    } catch {
      billingCard.innerHTML = '<div class="notice danger">We could not load your billing information. Refresh and try again.</div>';
    }
  }

  checkBillingHealth();
  loadBilling();
})();
