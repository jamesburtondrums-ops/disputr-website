(() => {
  const message = document.querySelector('[data-login-message]');
  const loginForm = document.querySelector('[data-login-form]');
  const accountCard = document.querySelector('[data-account-card]');
  const logoutButton = document.querySelector('[data-logout]');

  async function getMe() {
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    return response.json();
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = loginForm.querySelector('button');
      const email = loginForm.elements.email.value.trim();
      button.disabled = true;
      message.textContent = 'Sending your sign-in link…';
      try {
        const response = await fetch('/api/auth/request-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to request a sign-in link.');
        message.textContent = data.message;
        if (data.development_link) {
          message.innerHTML += `<br><a href="${data.development_link}">Development sign-in link</a>`;
        }
      } catch (error) {
        message.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  if (accountCard) {
    getMe().then((data) => {
      if (!data.authenticated) {
        window.location.href = 'login.html';
        return;
      }
      const sub = data.subscription;
      const status = sub?.status || 'No active plan';
      const end = sub?.trial_end || sub?.current_period_end || '';
      accountCard.innerHTML = `
        <h2>Account</h2>
        <p><strong>Signed in as:</strong> ${data.user.email}</p>
        <p><strong>Plan status:</strong> ${status}</p>
        ${end ? `<p><strong>Next important date:</strong> ${new Date(end).toLocaleDateString('en-GB')}</p>` : ''}
        <p><a class="btn" href="subscription-and-billing.html">Manage subscription</a></p>
      `;
    }).catch(() => { accountCard.innerHTML = '<p>We could not load your account right now.</p>'; });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.href = 'index.html';
    });
  }
})();
