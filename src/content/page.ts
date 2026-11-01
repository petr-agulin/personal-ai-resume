// Helpers shared by the page components.

import type { Lang, Locale, Site } from "./schema.ts";

/** Collapsible sections, in page order. Hero ("top") and Contact are always shown. */
export const SECTIONS = ["highlights", "experience", "skills", "projects", "education", "languages", "interests"] as const;
export type SectionId = (typeof SECTIONS)[number];

/** A section is hidden (with its nav link) when it has nothing to show. */
export function hasContent(id: SectionId, l: Locale): boolean {
  switch (id) {
    case "highlights":
      return l.highlights.length > 0;
    case "experience":
      return l.experience.length > 0;
    case "skills":
      return (l.skills.featured?.items.length ?? 0) > 0 || l.skills.groups.length > 0;
    case "education":
      return l.education.degrees.length > 0 || l.education.certifications.length > 0;
    case "languages":
      return l.languages.length > 0;
    case "projects":
      return l.projects.length > 0;
    case "interests":
      return l.interests.length > 0;
  }
}

/** "/" for the default language, "/sv/" (etc.) for the others. */
export function pagePath(lang: Lang, site: Site): string {
  return lang === site.defaultLanguage ? "/" : `/${lang}/`;
}

/** The privacy page: "/privacy/", "/sv/privacy/". */
export function privacyPath(lang: Lang, site: Site): string {
  return `${pagePath(lang, site)}privacy/`;
}

/** Where a certificate or test's "View" goes: its file (shown in a pop-up), its web page, or nowhere. */
export function viewTarget(item: { file?: string; url?: string }): { href: string; isFile: boolean } | null {
  if (item.file) return { href: `/files/${item.file}`, isFile: true };
  if (item.url) return { href: item.url, isFile: false };
  return null;
}
