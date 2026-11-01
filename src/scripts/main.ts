// Page interactions, added on top of the static HTML.
import { initPanel } from "./ai/panel.ts";
import { initModals } from "./modals.ts";
import { initNav } from "./nav.ts";
import { initSections } from "./sections.ts";

initNav();
initSections();
initModals();
initPanel();
