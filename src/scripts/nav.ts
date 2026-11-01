// Header nav: scroll-spy (underline the section being read), keep the active
// link visible in the scrollable phone row, fade the row's edge while there is
// more to scroll to, and point the language switch at the current section.

const ACTIVE_LINE = 120; // a section becomes active when its top passes this many px from the top

export function initNav(): void {
  const nav = document.querySelector<HTMLElement>(".site-nav");
  if (!nav) return;
  const links = [...nav.querySelectorAll<HTMLAnchorElement>("a")];
  const sections = links.map((a) => document.getElementById(a.hash.slice(1)));
  const langLinks = [...document.querySelectorAll<HTMLAnchorElement>(".lang-switch a")];
  let active = -1;

  function setActive(i: number) {
    if (i === active) return;
    active = i;
    links.forEach((a, j) => (j === i ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
    const id = links[i].hash.slice(1);
    for (const a of langLinks) a.hash = id === "top" ? "" : id;
    revealInRow(links[i]);
  }

  function update() {
    let current = 0;
    sections.forEach((s, i) => {
      if (s && s.getBoundingClientRect().top <= ACTIVE_LINE) current = i;
    });
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (atBottom) current = sections.length - 1;
    setActive(current);
  }

  // On phones the nav scrolls sideways; bring the active link into view.
  function revealInRow(link: HTMLElement) {
    if (nav!.scrollWidth <= nav!.clientWidth) return;
    const navBox = nav!.getBoundingClientRect();
    const box = link.getBoundingClientRect();
    if (box.left < navBox.left || box.right > navBox.right - 32) {
      nav!.scrollTo({ left: nav!.scrollLeft + box.left - navBox.left - 8, behavior: "smooth" });
    }
  }

  function updateFade() {
    const more = nav!.scrollLeft + nav!.clientWidth < nav!.scrollWidth - 2;
    nav!.classList.toggle("has-more", more);
  }

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  nav.addEventListener("scroll", updateFade, { passive: true });
  new ResizeObserver(updateFade).observe(nav);
  update();
  updateFade();
}
