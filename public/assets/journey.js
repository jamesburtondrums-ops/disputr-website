(() => {
  const result = document.querySelector("[data-result]");
  if (!result) return;

  function addJourney() {
    if (result.hidden || result.querySelector("[data-guided-journey]")) return;
    const panel = document.createElement("section");
    panel.className = "guided-journey";
    panel.dataset.guidedJourney = "";
    panel.innerHTML = `
      <div class="journey-heading">
        <span class="status-pill success">Draft ready</span>
        <h2>Your next steps</h2>
        <p>Take this one step at a time. You stay in control of what is sent.</p>
      </div>
      <ol class="journey-steps">
        <li class="complete"><span>1</span><div><strong>Review your wording</strong><p>Read the full draft and correct anything that is not exact.</p></div></li>
        <li><span>2</span><div><strong>Add your evidence</strong><p>Attach only the records that support the points you have made.</p></div></li>
        <li><span>3</span><div><strong>Send it through the official route</strong><p>Use the company complaints button above and keep the sent email, form receipt or reference.</p></div></li>
      </ol>
      <label class="sent-check"><input type="checkbox" data-mark-sent> <span>I have sent this complaint</span></label>
      <div class="after-send" data-after-send hidden>
        <span class="status-pill premium">After you send</span>
        <h3>Now keep the case moving</h3>
        <div class="mini-timeline">
          <div><strong>Today</strong><span>Save the final wording, proof of sending and attachments.</span></div>
          <div><strong>When they reply</strong><span>Record the date, outcome and anything still unresolved.</span></div>
          <div><strong>If it stalls</strong><span>Check the provider’s stated response time and escalation route.</span></div>
        </div>
        <div class="premium-nudge">
          <div><strong>Premium can organise this for you</strong><p>Save the case, track whether it is drafted or sent, and return to guided next steps in one secure workspace.</p></div>
          <div class="journey-actions"><button class="button" type="button" data-save-case>Save this case</button><a class="button secondary" href="checkout.html">View Premium</a></div>
        </div>
        <p class="form-message" data-save-message role="status"></p>
      </div>`;
    result.appendChild(panel);
    const checkbox = panel.querySelector("[data-mark-sent]");
    const afterSend = panel.querySelector("[data-after-send]");
    checkbox.addEventListener("change", () => {
      afterSend.hidden = !checkbox.checked;
      if (checkbox.checked) afterSend.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    const saveButton = panel.querySelector("[data-save-case]");
    const saveMessage = panel.querySelector("[data-save-message]");
    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      saveMessage.textContent = "Saving your case…";
      saveMessage.dataset.state = "loading";
      const subjectLine = [...result.querySelectorAll("p")].find((item) => item.textContent.startsWith("Suggested subject:"));
      const payload = {
        category: window.DISPUTR_BUILDER_CONFIG?.categoryLabel || "Complaint",
        company: document.querySelector("[data-company-input]")?.value || "Selected company",
        subject: subjectLine?.textContent.replace(/^Suggested subject:\s*/, "") || "Complaint",
        draft: result.querySelector("#draft")?.value || "",
        status: checkbox.checked ? "sent" : "draft"
      };
      try {
        const response = await fetch("/api/cases", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
          location.assign(`login.html?next=${encodeURIComponent(location.pathname.split("/").pop())}`);
          return;
        }
        if (response.status === 403) {
          saveMessage.innerHTML = 'Saving cases is a Premium feature. <a href="checkout.html">Start your free trial</a>.';
          saveMessage.dataset.state = "error";
          saveButton.disabled = false;
          return;
        }
        if (!response.ok) throw new Error(data.error || "We could not save this case.");
        saveMessage.innerHTML = 'Saved to <a href="dashboard.html">My Disputr</a>.';
        saveMessage.dataset.state = "success";
        saveButton.textContent = "Case saved";
      } catch (error) {
        saveMessage.textContent = error instanceof Error ? error.message : "We could not save this case.";
        saveMessage.dataset.state = "error";
        saveButton.disabled = false;
      }
    });
  }

  new MutationObserver(addJourney).observe(result, { childList: true, attributes: true });
  addJourney();
})();
