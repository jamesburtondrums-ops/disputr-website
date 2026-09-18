(() => {
  const form = document.querySelector('[data-contact-form]');
  const message = document.querySelector('[data-contact-status]');
  if (!form || !message) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Sending…';
    message.textContent = '';

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.elements.email.value.trim(),
          message: form.elements.message.value.trim(),
          website: form.elements.website.value
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Your message could not be sent. Please try again.');
      form.reset();
      message.textContent = data.message || 'Thanks — your message has been received.';
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : 'Your message could not be sent. Please try again.';
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
})();
