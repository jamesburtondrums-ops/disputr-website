(() => {
  const config = window.DISPUTR_BUILDER_CONFIG;
  if (!config) return;

  const form = document.querySelector('[data-complaint-form]');
  const searchInput = document.querySelector('[data-company-search]');
  const selectedInput = document.querySelector('[data-company-input]');
  const resultsPanel = document.querySelector('[data-company-results]');
  const selectedPanel = document.querySelector('[data-selected-company]');
  const contactPanel = document.querySelector('[data-company-contact]');
  const result = document.querySelector('[data-result]');
  const error = document.querySelector('[data-error]');
  let directory = [];
  let selectedCompany = null;

  const escapeHtml = (value = '') =>
    String(value).replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[character]);

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const next = text[index + 1];

      if (character === '"' && quoted && next === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === ',' && !quoted) {
        row.push(cell);
        cell = '';
      } else if ((character === '\n' || character === '\r') && !quoted) {
        if (character === '\r' && next === '\n') index += 1;
        row.push(cell);
        if (row.some((entry) => entry.trim())) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += character;
      }
    }

    row.push(cell);
    if (row.some((entry) => entry.trim())) rows.push(row);

    const headers = rows.shift().map((header) => header.trim());
    return rows.map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, (values[index] || '').trim()])
      )
    );
  }

  function allowedRecords() {
    return directory
      .filter((record) => config.categories.includes(record.category))
      .sort(
        (left, right) =>
          Number(left.popularity_rank || 9999) -
            Number(right.popularity_rank || 9999) ||
          left.name.localeCompare(right.name)
      );
  }

  function matches(record, query) {
    const haystack = [record.name, record.aliases].join(' ').toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  function renderResults(query = '') {
    if (!resultsPanel) return;

    const records = allowedRecords();
    const filtered = query.trim()
      ? records.filter((record) => matches(record, query)).slice(0, 12)
      : records.slice(0, 8);

    const heading = query.trim()
      ? filtered.length
        ? 'Matching companies'
        : 'No matching companies'
      : 'Popular companies';

    const companyButtons = filtered
      .map(
        (record) => `
          <button
            type="button"
            class="company-option"
            data-company-id="${escapeHtml(record.id)}"
          >
            <span>${escapeHtml(record.name)}</span>
            <small>${escapeHtml(record.category.replace(/_/g, ' '))}</small>
          </button>
        `
      )
      .join('');

    resultsPanel.innerHTML = `
      <div class="company-results-heading">${heading}</div>
      <div class="company-options">
        ${companyButtons || '<p class="muted company-empty">Try another spelling or enter the company manually below.</p>'}
      </div>
      <button type="button" class="manual-company-link" data-use-manual-company>
        I cannot find my provider — enter it manually
      </button>
    `;

    resultsPanel.hidden = false;

    resultsPanel.querySelectorAll('[data-company-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const company = directory.find(
          (record) => record.id === button.dataset.companyId
        );
        chooseCompany(company);
      });
    });

    resultsPanel
      .querySelector('[data-use-manual-company]')
      .addEventListener('click', useManualCompany);
  }

  function canShowEmail(company) {
    return Boolean(
      company &&
        company.complaint_email &&
        company.verification_status === 'verified' &&
        company.last_checked &&
        company.source_url
    );
  }

  function renderContact(company) {
    if (!contactPanel) return;

    if (!company) {
      contactPanel.innerHTML = `
        <p class="muted">
          Select a company to see its stored official complaint route. Always check
          the provider's own website before sending personal information.
        </p>
      `;
      return;
    }

    const route = company.complaint_url
      ? `
        <a class="button secondary" href="${escapeHtml(company.complaint_url)}"
          target="_blank" rel="noopener">
          Open official complaints route
        </a>
      `
      : '';

    const email = canShowEmail(company)
      ? `
        <button type="button" class="button secondary" data-copy-email>
          Copy verified complaints email
        </button>
        <span class="company-email">${escapeHtml(company.complaint_email)}</span>
      `
      : '';

    const status = company.verification_status === 'verified'
      ? `Verified contact route. Last checked: ${escapeHtml(company.last_checked)}.`
      : 'Check the current contact route on the provider’s official website before sending.';

    contactPanel.innerHTML = `
      <div class="contact-card">
        <div>
          <strong>Official complaint route</strong>
          <p>${escapeHtml(company.contact_method || 'Provider complaints route')}</p>
        </div>
        <div class="contact-actions">${route}${email}</div>
        <p class="muted">${status}</p>
      </div>
    `;

    const copyButton = contactPanel.querySelector('[data-copy-email]');
    if (copyButton) {
      copyButton.addEventListener('click', async () => {
        await navigator.clipboard.writeText(company.complaint_email);
        copyButton.textContent = 'Email copied';
      });
    }
  }

  function chooseCompany(company) {
    if (!company) return;

    selectedCompany = company;
    selectedInput.value = company.name;
    searchInput.value = company.name;

    selectedPanel.innerHTML = `
      <div class="selected-company-card">
        <div>
          <span class="selected-company-label">Selected provider</span>
          <strong>${escapeHtml(company.name)}</strong>
        </div>
        <button type="button" class="text-button" data-change-company>Change</button>
      </div>
    `;

    selectedPanel.hidden = false;
    resultsPanel.hidden = true;
    renderContact(company);

    selectedPanel
      .querySelector('[data-change-company]')
      .addEventListener('click', clearSelection);
  }

  function clearSelection() {
    selectedCompany = null;
    selectedInput.value = '';
    searchInput.value = '';
    selectedPanel.hidden = true;
    renderContact(null);
    searchInput.focus();
    renderResults();
  }

  function useManualCompany() {
    selectedCompany = null;
    selectedInput.value = '';
    selectedPanel.hidden = true;
    resultsPanel.hidden = true;

    contactPanel.innerHTML = `
      <label class="manual-company-field">
        Enter the provider or company name
        <input data-manual-company-name type="text" autocomplete="organization"
          placeholder="For example: Example Energy">
      </label>
      <p class="muted">
        Check the provider's official website, account area, contract, bill or booking
        confirmation for its current complaints route.
      </p>
    `;

    const manualInput = contactPanel.querySelector('[data-manual-company-name]');
    manualInput.focus();
    manualInput.addEventListener('input', () => {
      selectedInput.value = manualInput.value.trim();
    });
  }

  async function loadDirectory() {
    try {
      const response = await fetch('assets/company-directory.csv', {
        cache: 'no-store'
      });

      if (!response.ok) throw new Error('Company directory unavailable');

      directory = parseCsv(await response.text());
      renderResults();
      renderContact(null);
    } catch (loadError) {
      console.error(loadError);
      resultsPanel.hidden = true;
      contactPanel.innerHTML = `
        <label class="manual-company-field">
          Enter the provider or company name
          <input data-manual-company-name type="text" autocomplete="organization"
            placeholder="Enter the company name">
        </label>
        <p class="muted">The company directory is temporarily unavailable.</p>
      `;

      const manualInput = contactPanel.querySelector('[data-manual-company-name]');
      manualInput.addEventListener('input', () => {
        selectedInput.value = manualInput.value.trim();
      });
    }
  }

  function formValue(name) {
    return form.elements[name] ? form.elements[name].value : '';
  }

  function renderResult(payload) {
    const contact = selectedCompany;
    const route = contact?.complaint_url
      ? `
        <p>
          <a class="button secondary" href="${escapeHtml(contact.complaint_url)}"
            target="_blank" rel="noopener">
            Open official complaints route
          </a>
        </p>
      `
      : `
        <p class="muted">
          Check the provider's official website or account area for its current
          complaint contact route.
        </p>
      `;

    const email = canShowEmail(contact)
      ? `
        <p>
          <button type="button" class="button secondary" data-result-copy-email>
            Copy verified complaints email
          </button>
        </p>
      `
      : '';

    const facts = (payload.facts_to_check || [])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('') || '<li>Check all dates, references and details before sending.</li>';

    const attachments = (payload.suggested_attachments || [])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');

    result.innerHTML = `
      <section class="result-card">
        <h2>${escapeHtml(payload.title || 'Suggested complaint')}</h2>
        <p><strong>Suggested recipient:</strong> ${escapeHtml(payload.recipient_suggestion || '')}</p>
        <p><strong>Suggested subject:</strong> ${escapeHtml(payload.subject || '')}</p>
        ${route}
        ${email}
        <label for="generated-draft"><strong>Your suggested complaint</strong></label>
        <textarea id="generated-draft" rows="22">${escapeHtml(payload.draft || '')}</textarea>
        <p><button type="button" class="button" data-copy-draft>Copy complaint</button></p>
        <h3>Facts to check</h3>
        <ul>${facts}</ul>
        <h3>Suggested attachments</h3>
        <ul>${attachments}</ul>
        <p><strong>Next step:</strong> ${escapeHtml(payload.suggested_next_step || '')}</p>
        <p class="muted">${escapeHtml(payload.disclaimer || '')}</p>
      </section>
    `;

    result.hidden = false;

    result.querySelector('[data-copy-draft]').addEventListener('click', async () => {
      await navigator.clipboard.writeText(
        document.querySelector('#generated-draft').value
      );
      result.querySelector('[data-copy-draft]').textContent = 'Copied';
    });

    const copyEmail = result.querySelector('[data-result-copy-email]');
    if (copyEmail && contact) {
      copyEmail.addEventListener('click', async () => {
        await navigator.clipboard.writeText(contact.complaint_email);
        copyEmail.textContent = 'Email copied';
      });
    }
  }

  searchInput.addEventListener('focus', () => renderResults(searchInput.value));
  searchInput.addEventListener('input', () => renderResults(searchInput.value));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    result.hidden = true;

    if (!selectedInput.value.trim()) {
      error.textContent = 'Please select a company or enter the company name manually.';
      error.hidden = false;
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    const originalLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Creating your complaint…';

    const payload = {
      category: config.categoryLabel,
      company: selectedInput.value.trim(),
      issueType: formValue('issueType'),
      incidentDate: formValue('incidentDate'),
      referenceNumber: formValue('referenceNumber'),
      whatHappened: formValue('whatHappened'),
      priorContact: formValue('priorContact'),
      costsOrLosses: formValue('costsOrLosses'),
      desiredOutcome: formValue('desiredOutcome'),
      tone: formValue('tone')
    };

    try {
      const response = await fetch('/api/generate-complaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'We could not create your draft right now.');
      }

      renderResult(data);
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (requestError) {
      error.textContent = requestError.message;
      error.hidden = false;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  });

  loadDirectory();
})();
