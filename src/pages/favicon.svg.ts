// The browser tab icon: the owner's initials from site.json, styled like the
// AI panel's avatar. Built as a static /favicon.svg.
import type { APIRoute } from "astro";
import { loadContent } from "../content/load.ts";

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export const GET: APIRoute = () => {
  const initials = escapeXml(loadContent().site.initials.toUpperCase());
  const fontSize = initials.length > 2 ? 11 : 14;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect x="1" y="1" width="30" height="30" rx="8" fill="#1c1a26" stroke="#a78bfa" stroke-width="1.5"/>
  <text x="16" y="16" dominant-baseline="central" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="${fontSize}" font-weight="600" fill="#c4b5fd">${initials}</text>
</svg>
`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
};
