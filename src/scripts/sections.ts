// Collapsible sections and "+ N more" / "Show less" in Experience.

export function initSections(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".section__toggle")) {
    const body = document.getElementById(button.getAttribute("aria-controls") ?? "");
    if (!body) continue;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      body.hidden = !open;
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>(".more-button")) {
    const job = button.closest(".job");
    if (!job) continue;
    button.addEventListener("click", () => {
      const open = job.classList.toggle("is-expanded");
      button.setAttribute("aria-expanded", String(open));
      button.textContent = (open ? button.dataset.less : button.dataset.more) ?? "";
    });
  }
}
