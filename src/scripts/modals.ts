// Pop-ups: case studies and the certificate viewer. Native <dialog> gives
// Esc to close, keeps focus inside, and returns focus to the link on close.
// Clicking the dark backdrop or × also closes. Without JavaScript the links
// still work: case studies are shown on the page, files open in a new tab.

/** The link that opened each pop-up, to give it focus back on close (Safari doesn't do this itself). */
const openers = new WeakMap<HTMLDialogElement, HTMLElement>();

function open(dialog: HTMLDialogElement, opener: HTMLElement) {
  openers.set(dialog, opener);
  dialog.showModal();
}

export function initModals(): void {
  for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog.modal")) {
    dialog.addEventListener("click", (e) => {
      // A click on the dialog element itself (not its content) is the backdrop.
      if (e.target === dialog || (e.target as Element).closest("[data-close]")) dialog.close();
    });
    dialog.addEventListener("close", () => openers.get(dialog)?.focus({ preventScroll: true }));
  }

  const viewer = document.getElementById("viewer") as HTMLDialogElement | null;
  viewer?.addEventListener("close", () => viewer.querySelector(".viewer__media")?.replaceChildren());

  document.addEventListener("click", (e) => {
    const link = (e.target as Element).closest<HTMLAnchorElement>("a[data-case-study], a[data-viewer]");
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;

    if (link.dataset.caseStudy) {
      const dialog = document.getElementById(link.dataset.caseStudy) as HTMLDialogElement | null;
      if (!dialog) return;
      e.preventDefault();
      open(dialog, link);
      return;
    }

    if (viewer && openInViewer(viewer, link)) e.preventDefault();
  });
}

/** Fills the viewer with the linked image or PDF. Returns false to let the link open normally. */
function openInViewer(viewer: HTMLDialogElement, link: HTMLAnchorElement): boolean {
  const href = link.getAttribute("href") ?? "";
  const isPdf = /\.pdf$/i.test(href);
  // PDFs inside a pop-up work poorly on phones (iOS especially); let the
  // phone's own viewer open them instead.
  if (isPdf && window.matchMedia("(pointer: coarse)").matches) return false;

  const title = link.dataset.title ?? "";
  viewer.querySelector(".viewer__title")!.textContent = title;
  viewer.querySelector(".viewer__subtitle")!.textContent = link.dataset.subtitle ?? "";

  let media: HTMLElement;
  if (isPdf) {
    const frame = document.createElement("iframe");
    frame.src = href;
    frame.title = title;
    media = frame;
  } else {
    const img = document.createElement("img");
    img.src = href;
    img.alt = title;
    media = img;
  }
  viewer.querySelector(".viewer__media")!.replaceChildren(media);
  open(viewer, link);
  return true;
}
