(() => {
  const container = document.querySelector("[data-case-list]");
  if (!container) return;
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  fetch("/api/cases", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
    .then(({ response, data }) => {
      if (response.status === 403) {
        container.innerHTML = '<div class="empty-cases"><h3>Case tracking is included with Premium</h3><p>Upgrade when you want to save complaints and keep their progress visible.</p><a class="btn secondary" href="checkout.html">Try Premium free</a></div>';
        return;
      }
      if (!response.ok) throw new Error(data.error || "Unable to load cases.");
      if (!data.cases?.length) {
        container.innerHTML = '<div class="empty-cases"><h3>No saved cases yet</h3><p>Create a complaint, then use “Save this case” after your draft is ready.</p><a class="btn secondary" href="complaint-hub.html">Start a complaint</a></div>';
        return;
      }
      container.innerHTML = data.cases.map((item) => {
        const date = new Date(Number(item.updated_at) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
        return `<article class="case-row"><div><span class="status-pill ${item.status === "sent" ? "success" : ""}">${escapeHtml(item.status)}</span><h3>${escapeHtml(item.company)}</h3><p>${escapeHtml(item.subject)}</p></div><span class="case-date">Updated ${date}</span></article>`;
      }).join("");
    })
    .catch((error) => { container.innerHTML = `<div class="notice danger">${escapeHtml(error.message)}</div>`; });
})();
