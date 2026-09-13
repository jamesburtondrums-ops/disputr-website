(() => {
  const startButtons = [...document.querySelectorAll('[data-start-trial]')];
  const message = document.querySelector('[data-billing-message]');
  const billingCard = document.querySelector('[data-billing-card]');

  function setStartBusy(busy) {
    startButtons.forEach((button) => {
      button.disabled = busy;
      button.setAttribute('aria-busy', String(busy));
    });
    if (billingCard) {
      if (busy) billingCard.setAttribute('aria-busy', 'true');
      else billingCard.removeAttribute('aria-busy');
    }
  }

  async function readJson(response) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return {};
    return response.json().catch(() => ({}));
  }

  async function startTrial() {
    if (message) message.textContent = 'Preparing secure checkout…';
    setStartBusy(true);

    try {
      const response = await fetch('/api/billing/create-checkout-session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' }
      });
      const data = await readJson(response);

      if (response.status === 401) {
        const next = encodeURIComponent(location.pathname + location.search);
        location.assign(`login.html?next=${next}`);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || 'Unable to start checkout.');
      }

      const checkoutUrl = data.checkoutUrl || data.url;
      if (!checkoutUrl || !/^https:\/\//i.test(checkoutUrl)) {
        throw new Error('The server did not return a valid Stripe Checkout URL.');
      }

      location.assign(checkoutUrl);
    } catch (error) {
      console.error('Unable to start checkout:', error);
      if (message) {
        message.textContent = error instanceof Error
          ? error.message
          : 'Unable to start checkout. Please try again.';
      }
      setStartBusy(false);
    }
  }

  startButtons.forEach((button) => button.addEventListener('click', startTrial));

  async function loadBillingCard() {
    if (!billingCard) return;

    try {
      const response = await fetch('/api/me', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' }
      });
      const data = await readJson(response);

      if (!response.ok || !data.authenticated) {
        location.assign('login.html?next=subscription-and-billing.html');
        return;
      }

      const sub = data.subscription;
      if (!sub) {
        billingCard.innerHTML = `
          <h2>No active subscription</h2>
          <p>You have not started a Premium trial or subscription.</p>
          <a class="btn" href="pricing.html">Start 14-day free trial</a>
        `;
        return;
      }

      const rawDate = sub.trial_end || sub.current_period_end;
      const dateValue = rawDate
        ? new Date(Number(rawDate) > 1e12 ? Number(rawDate) : Number(rawDate) * 1000)
        : null;
      const dateText = dateValue && !Number.isNaN(dateValue.getTime())
        ? dateValue.toLocaleDateString('en-GB')
        : '';

      billingCard.innerHTML = `
        <h2>Disputr Premium</h2>
        <p><strong>Status:</strong> ${String(sub.status || 'unknown')}</p>
        ${dateText ? `<p><strong>Next important date:</strong> ${dateText}</p>` : ''}
        <p><strong>Price:</strong> £5.00 per month after any applicable 14-day free trial.</p>
        <p>${sub.cancel_at_period_end ? 'Your subscription is set to cancel at the end of the current billing period.' : 'Your subscription renews monthly unless cancelled.'}</p>
        <button class="btn" type="button" data-open-portal>Manage payment or cancel</button>
        <p data-portal-message role="status"></p>
      `;

      const portalButton = billingCard.querySelector('[data-open-portal]');
      const portalMessage = billingCard.querySelector('[data-portal-message]');
      portalButton?.addEventListener('click', async () => {
        portalButton.disabled = true;
        if (portalMessage) portalMessage.textContent = 'Opening secure billing portal…';
        try {
          const portalResponse = await fetch('/api/billing/create-portal-session', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { accept: 'application/json' }
          });
          const payload = await readJson(portalResponse);
          if (!portalResponse.ok) throw new Error(payload.error || 'Unable to open billing portal.');
          const portalUrl = payload.url || payload.portalUrl;
          if (!portalUrl || !/^https:\/\//i.test(portalUrl)) throw new Error('The server did not return a valid billing portal URL.');
          location.assign(portalUrl);
        } catch (error) {
          if (portalMessage) portalMessage.textContent = error instanceof Error ? error.message : 'Unable to open billing portal.';
          portalButton.disabled = false;
        }
      });
    } catch (error) {
      console.error('Unable to load billing information:', error);
      billingCard.innerHTML = '<p>We could not load your billing information right now. Please refresh and try again.</p>';
    }
  }

  loadBillingCard();
})();
