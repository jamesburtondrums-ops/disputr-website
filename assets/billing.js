(() => {
  const startButtons = document.querySelectorAll('[data-start-trial]');
  const message = document.querySelector('[data-billing-message]');
  const billingCard = document.querySelector('[data-billing-card]');

  async function startTrial() {
  if (message) {
    message.textContent = "Preparing secure checkout…";
  }

  try {
    const response = await fetch(
      "/api/billing/create-checkout-session",
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
        },
      }
    );

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : {
          error:
            "The server returned an unexpected response. Check the Cloudflare Worker logs.",
        };

    if (response.status === 401) {
      window.location.href = "login.html?next=checkout";
      return;
    }

    if (!response.ok) {
      throw new Error(
        data.error || `Checkout request failed (${response.status}).`
      );
    }

    if (!data.checkoutUrl) {
      throw new Error(
        "Checkout was created, but the server did not return a Stripe Checkout URL."
      );
    }

    window.location.assign(data.checkoutUrl);
  } catch (error) {
    console.error("Unable to start checkout:", error);

    if (message) {
      message.textContent =
        error instanceof Error
          ? error.message
          : "Unable to start checkout. Please try again.";
    }
  }
}
      }
      if (!response.ok) throw new Error(data.error || 'Unable to start checkout.');
      window.location.href = data.url;
    } catch (error) {
      if (message) message.textContent = error.message;
    }
  }

  startButtons.forEach((button) => button.addEventListener('click', startTrial));

  if (billingCard) {
    fetch('/api/me', { credentials: 'same-origin' })
      .then((response) => response.json())
      .then((data) => {
        if (!data.authenticated) {
          window.location.href = 'login.html';
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
        const date = sub.trial_end || sub.current_period_end;
        billingCard.innerHTML = `
          <h2>Disputr Premium</h2>
          <p><strong>Status:</strong> ${sub.status}</p>
          ${date ? `<p><strong>Next important date:</strong> ${new Date(date).toLocaleDateString('en-GB')}</p>` : ''}
          <p><strong>Price:</strong> £5.00 per month after any applicable 14-day free trial.</p>
          <p>${sub.cancel_at_period_end ? 'Your subscription is set to cancel at the end of the current billing period.' : 'Your subscription renews monthly unless cancelled.'}</p>
          <button class="btn" data-open-portal>Manage payment or cancel</button>
          <p data-portal-message role="status"></p>
        `;
        billingCard.querySelector('[data-open-portal]').addEventListener('click', async () => {
          const portalMessage = billingCard.querySelector('[data-portal-message]');
          portalMessage.textContent = 'Opening secure billing portal…';
          try {
            const response = await fetch('/api/billing/create-portal-session', { method: 'POST', credentials: 'same-origin' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Unable to open billing portal.');
            window.location.href = payload.url;
          } catch (error) {
            portalMessage.textContent = error.message;
          }
        });
      })
      .catch(() => { billingCard.innerHTML = '<p>We could not load your billing information right now.</p>'; });
  }
})();
