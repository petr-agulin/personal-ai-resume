// The shape of the content files (content/ or content.example/).
// scripts/build-schemas.ts turns these into JSON Schemas in schema/, which
// give VS Code autocomplete, hover help and error highlighting.
// Every `describe()` text shows up as hover help, so keep it plain.

import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { z } from "zod";

export const LANGS = ["en", "sv"] as const;
export type Lang = (typeof LANGS)[number];

const iconsDir = join(
  dirname(createRequire(import.meta.url).resolve("lucide-static/package.json")),
  "icons",
);
export const ICON_NAMES = readdirSync(iconsDir)
  .filter((f) => f.endsWith(".svg"))
  .map((f) => f.slice(0, -4))
  .sort();

const text = (description: string) =>
  z.string().trim().min(1, "Must not be empty.").describe(description);

const url = (description: string) =>
  z
    .url({ protocol: /^https?$/, error: "Must be a full web address starting with https://" })
    .describe(description);

const icon = (description: string) =>
  z
    .enum(ICON_NAMES, {
      error: (iss) =>
        `Unknown icon "${String(iss.input)}". Use a Lucide icon name such as "compass"; VS Code suggests the valid names.`,
    })
    .describe(description);

const yearMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use the format "YYYY-MM", for example "2022-02".');

const filePath = z
  .string()
  .regex(
    /^(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9_./-]*\.(pdf|png|jpe?g|webp)$/i,
    'Use a file name inside the files/ folder, like "my-certificate.pdf". Allowed: .pdf, .png, .jpg, .webp; letters, numbers, - _ / only.',
  )
  .describe(
    "A file in this content folder's files/ subfolder, e.g. \"my-certificate.png\". Images display better on phones than PDFs.",
  );

const certificateUrl = url(
  "Optional web page for this certificate, e.g. a LinkedIn Learning certificate link. Used when there is no file; if both are set, the file wins.",
).optional();

const boldPairs =(s: string) => (s.match(/\*\*/g) ?? []).length % 2 === 0;

// ---------------------------------------------------------------- site.json

export const siteSchema = z
  .strictObject({
    $schema: z.string().optional(),
    name: text("Your full name. Shown as the big heading, in the footer and in the page title."),
    firstName: text(
      'What visitors call you, e.g. in "Contact Jane about this role". Default: the first word of name.',
    ).optional(),
    initials: z
      .string()
      .trim()
      .min(1, "Must not be empty.")
      .max(3, "Use at most 3 letters.")
      .describe('1–3 letters for the round avatar in the AI panel, e.g. "JS".'),
    email: z
      .email({ error: "Must be an email address, like name@example.com." })
      .describe("Contact email. Shown on the page and given out by the AI when it can't answer."),
    linkedin: url("Your LinkedIn profile address. Leave out to hide the LinkedIn button.").optional(),
    github: url("Your GitHub profile address. Leave out to hide the GitHub button.").optional(),
    siteUrl: url(
      "The site's public address, e.g. https://personal-ai-resume.<your-subdomain>.workers.dev. Used for link previews.",
    ),
    languages: z
      .array(z.enum(LANGS))
      .min(1, "List at least one language.")
      .describe(
        'Languages of the site. ["en", "sv"] needs both en.json and sv.json and shows the EN | SE switch. ["en"] hides the switch.',
      ),
    defaultLanguage: z
      .enum(LANGS)
      .describe("The language at the site's main address (/). The other language gets its own address, e.g. /sv/."),
    turnstileSiteKey: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Public Turnstile site key (docs/SETUP.md step E). Leave out until then; local testing uses Cloudflare's test key."),
    aiProvider: z
      .strictObject({
        name: text('The company that writes the AI answers, e.g. "Groq".'),
        country: text('Where that company is based, e.g. "USA". Shown in brackets after the name.'),
      })
      .default({ name: "Groq", country: "USA" })
      .describe(
        "Who generates the AI answers, as named on the privacy page. Must match AI_API_URL in wrangler.jsonc. Default: Groq (USA).",
      ),
    logRegion: text(
      'Where your live visitor log database is, as named on the privacy page, e.g. "EU" or "USA". Default: "EU". npm run deploy refuses to publish "EU" unless the database really is restricted to the EU.',
    ).default("EU"),
  })
  .superRefine((site, ctx) => {
    if (new Set(site.languages).size !== site.languages.length) {
      ctx.addIssue({ code: "custom", path: ["languages"], message: "Each language may be listed only once." });
    }
    if (!site.languages.includes(site.defaultLanguage)) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultLanguage"],
        message: `"${site.defaultLanguage}" must also be listed in "languages".`,
      });
    }
  });

// ------------------------------------------------------ en.json and sv.json

const caseStudy = z
  .strictObject({
    facts: z
      .array(
        z.strictObject({
          label: text('Short label, e.g. "Role", "Team" or "Timeline".'),
          value: text('The value, e.g. "Product Manager".'),
        }),
      )
      .default([])
      .describe("Small tiles at the top of the case study."),
    blocks: z
      .array(
        z.strictObject({
          heading: text('Block heading, e.g. "Context", "What I did", "Outcome", "What I learned".'),
          items: z.array(text("One bullet point.")).min(1, "Add at least one item."),
        }),
      )
      .min(1, "Add at least one block.")
      .describe("The sections of the case study, in order."),
  })
  .describe('Optional. With a case study the card shows "Read case study"; without one it shows no link.');

const highlight = z.strictObject({
  tag: text('Small label above the title, e.g. "AI · ESG".'),
  title: text("Card title. Keep it short."),
  text: text("One or two sentences. Keep it brief, so the cards stay even."),
  caseStudy: caseStudy.optional(),
  comingSoon: z
    .boolean()
    .optional()
    .describe('true shows "Coming soon" where "Read case study" would be, for a case study not written yet. Ignored when the card has a case study.'),
});

const job = z
  .strictObject({
    start: yearMonth.describe('First month, as "YYYY-MM", e.g. "2022-02".'),
    end: yearMonth
      .nullable()
      .describe('Last month, as "YYYY-MM". Use null for your current job ("Present").'),
    company: text("Company name."),
    role: text("Your job title."),
    about: text("One line about the company, shown in small grey text.").optional(),
    bullets: z
      .array(text("One achievement or responsibility."))
      .default([])
      .describe('What you did. The first 3 show; the rest sit behind "+ N more".'),
  })
  .superRefine((j, ctx) => {
    if (j.end !== null && j.end < j.start) {
      ctx.addIssue({ code: "custom", path: ["end"], message: `End (${j.end}) is before start (${j.start}).` });
    }
  });

const chips = (description: string) => z.array(text("One skill.")).describe(description);

const skills = z
  .strictObject({
    featured: z
      .strictObject({
        label: text('Heading of the full-width card, e.g. "Product Management".'),
        icon: icon('Icon for the card label. Default: "compass".').optional(),
        items: chips("Skills in the full-width card.").default([]),
      })
      .optional()
      .describe("The full-width card at the top of Skills."),
    groups: z
      .array(
        z.strictObject({
          label: text('Group heading, e.g. "Tools".'),
          icon: icon("Icon for the group heading."),
          wide: z.boolean().optional().describe("true makes this card about twice as wide. Good for long lists."),
          items: chips("Skills in this group.").min(1, "Add at least one skill."),
        }),
      )
      .default([])
      .describe("Cards below the featured one, in order."),
  })
  .default({ groups: [] });

const education = z
  .strictObject({
    degrees: z
      .array(
        z.strictObject({
          title: text("Degree name."),
          org: text("University or school."),
        }),
      )
      .default([]),
    certifications: z
      .array(
        z.strictObject({
          title: text("Certificate name."),
          org: text("Who issued it."),
          year: text('Year, e.g. "2024".').optional(),
          file: filePath.optional(),
          url: certificateUrl,
        }),
      )
      .default([])
      .describe('With a file, "View ↗" opens it in a pop-up. With only a url, it opens that page in a new tab. With neither, there is no "View".'),
  })
  .default({ degrees: [], certifications: [] });

const language = z.strictObject({
  name: text('Language name, e.g. "English".'),
  level: text('Your level, e.g. "Full professional proficiency (C1/C2)".'),
  tests: z
    .array(
      z.strictObject({
        name: text('Test name, e.g. "EF SET".'),
        result: text('Result, e.g. "C2 · 74/100".').optional(),
        file: filePath.optional(),
        url: certificateUrl,
      }),
    )
    .default([])
    .describe(
      "Test results, shown as chips on the right. With a file, the chip opens it in a pop-up; with only a url, it opens that page in a new tab.",
    ),
});

const project = z.strictObject({
  title: text("Project name."),
  text: text("One or two sentences on what it does and how it was built."),
  github: url("The project's GitHub address. Optional: without it there is no GitHub button.").optional(),
  link: z
    .strictObject({
      url: url("Where the second button goes."),
      label: text('Button text, e.g. "Try the app".'),
    })
    .optional()
    .describe("Optional second button, next to GitHub."),
});

const interest = z.strictObject({
  icon: icon("Icon in the small round badge."),
  name: text("The interest."),
  text: text("One line about it."),
});

export const localeSchema = z.strictObject({
  $schema: z.string().optional(),
  meta: z
    .strictObject({
      title: text("Browser tab title and link-preview title."),
      description: text("One sentence for search results and link previews."),
    })
    .describe("Search and link-preview text."),
  hero: z
    .strictObject({
      tags: z
        .array(
          z.strictObject({
            text: text("Tag text."),
            tone: z.enum(["green", "blue"]).describe('"green" or "blue".'),
          }),
        )
        .default([])
        .describe("Small coloured pills above your name."),
      title: text('Shown under your name, e.g. "Product Manager".'),
      paragraphs: z
        .array(
          text("One paragraph. Wrap words in **double asterisks** to make them bold.").refine(boldPairs, {
            message: "Unmatched **: bold markers must come in pairs, like **this**.",
          }),
        )
        .default([])
        .describe("The introduction under your title."),
    })
    .describe("The top of the page."),
  highlights: z.array(highlight).default([]).describe("Key highlights cards. An empty list hides the section."),
  experience: z.array(job).default([]).describe("Jobs, newest first. An empty list hides the section."),
  skills,
  education,
  languages: z.array(language).default([]).describe("Languages you speak. An empty list hides the section."),
  projects: z.array(project).default([]).describe("Vibe projects. An empty list hides the section."),
  interests: z.array(interest).default([]).describe("Personal interests. An empty list hides the section."),
  contact: z
    .strictObject({
      question: text("A line inviting people to get in touch.").optional(),
      location: text('Where you are, e.g. "Uppsala, Sweden".').optional(),
      workStatus: text('Your right to work, e.g. "EU citizen" or "Open to relocation".').optional(),
    })
    .default({})
    .describe("The Contact section. Email, LinkedIn and GitHub come from site.json."),
  assistant: z
    .strictObject({
      name: text('Name shown in the AI panel header, e.g. "Jane\'s AI".'),
      subtitle: text('Line under the name, e.g. "Answers as Jane, grounded in her resume".'),
      greeting: text("First message the visitor sees in the chat."),
      starters: z
        .array(text("A suggested question the visitor can click."))
        .max(6, "Use at most 6 starters.")
        .default([])
        .describe("Suggested questions under the greeting."),
      limitsNote: text(
        'Optional. Your own line in the panel\'s note about wait times, after the general explanation, e.g. "This site runs on a free AI plan, which allows about two questions a minute." Leave it out if you have nothing to add.',
      ).optional(),
    })
    .describe("Texts for the AI panel."),
});

export type Site = z.output<typeof siteSchema>;
export type Locale = z.output<typeof localeSchema>;
