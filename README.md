# personal-ai-resume

A one-page resume site with an AI assistant that answers in your voice. Visitors can **ask about you** in a chat, or paste a job ad to **analyze job fit**: a score, strengths, gaps and your most relevant experience, which they can email or save as a PDF. In English and Swedish, hosted on Cloudflare's free plan.

Your own content never goes into git. You keep it in a private `content/` folder on your computer, and it's uploaded to Cloudflare only when you publish. This repo ships a fictional example person, John Smith, so it runs out of the box.

## What you get

- **The page:** hero, key highlights with optional case studies, experience, skills, side projects, education with certificate pop-ups, languages, interests, contact. Sections without content disappear. English at `/`, Swedish at `/sv/`.
- **The AI assistant**, with any AI provider that offers an OpenAI-compatible chat API. It comes set up for Groq's free plan (model `openai/gpt-oss-120b`), which is what it's tested with. It:
  - answers only about you, from your content, in the visitor's language, and refuses everything else;
  - can draw on private notes that aren't shown on the page, searched per question;
  - job-fit reports in the job ad's language.
- **Protection:** an invisible bot check (Cloudflare Turnstile), per-visitor speed limits, daily caps for the whole site, and a size budget that keeps every AI request within your plan.
- **A private admin page** behind a Cloudflare login, showing what visitors asked, job-fit results and AI errors. You can delete any entry yourself, and entries older than 12 months are deleted automatically.
- **A privacy page** in both languages. No tracking cookies, no analytics, no IP addresses stored.

Built with Astro (static pages), plain TypeScript and Cloudflare Workers.

## Quick start (on your computer)

You need [Node.js](https://nodejs.org) 22.23 or newer.

```
npm install
npm run dev
```

Open the address it prints, usually http://localhost:4321 (if that port is taken, it picks the next free one). Without your own content you'll see the example person. This preview gives sample AI answers; for the real AI, see "Try the real AI locally" below.

## Put in your own content

1. Copy the `content.example/` folder to a new folder named `content/`. The site uses `content/` as soon as it exists. Git ignores it.
2. Edit the files in your new `content/` folder (listed in the table below) in VS Code, with `npm run dev` running. The page updates as you save, and VS Code autocompletes fields and explains each one (from `schema/`).

| File | What it holds |
|---|---|
| `site.json` | Your name, email, links, the site's address (`siteUrl`), languages, and the bot check's public key. |
| `en.json`, `sv.json` | Everything on the page, one complete file per language: meta, hero, highlights and case studies, experience, skills, education, languages, projects, interests, contact, and the assistant's greeting and suggested questions. |
| `ai-notes.md` | Facts only the AI sees, sent with every question: the roles you want, notice period, practical details, what you have little experience with. Keep it short. |
| `notes/*.md` | Optional background the AI looks up when a question needs it. Each `## Heading` is one topic; keep each under about 600 words. |
| `files/` | Certificate images or PDFs (shown in a pop-up), and optionally `og-image.png` (1200×630), the picture shown when your link is shared on LinkedIn, Slack and similar. Everything here is published. |

- Only use one language? Set `"languages": ["en"]` in `site.json`; the switch disappears.
- Never put anything secret or private in your content: the AI may repeat any of it to visitors. Leave out your phone number.
- `npm run content` checks your files and tells you exactly what's wrong.

## Try the real AI locally

1. Get a key from your AI provider (a free Groq key works as is) and log in to Cloudflare: [docs/SETUP.md](docs/SETUP.md), "How secrets work" and steps A–B.
2. Copy `dev.vars.example` to `.dev.vars` and fill it in. Git ignores it.
3. Run `npm run dev:ai` and open the address it prints, usually http://localhost:8787.

## Go live

Follow [docs/SETUP.md](docs/SETUP.md) steps C–H, in order: your Cloudflare address, the visitor log database, the bot check, the secrets, publishing with `npm run deploy`, and the private admin login. It takes about an hour the first time.

After that, publishing a change is one command:

```
npm run deploy
```

It refuses to publish the example person or leftover placeholder text. `npm run deploy -- --dry-run` rehearses without publishing.

## Using another AI provider

The site talks to the AI through the common OpenAI-style chat API, which most providers offer (OpenAI, Groq, OpenRouter, Mistral, Cerebras and others). To switch:

1. In `wrangler.jsonc`, set `AI_API_URL` to the provider's chat completions address and `AI_MODEL` to the model's name.
2. Store the provider's key as the `AI_API_KEY` secret, live and in `.dev.vars` ([SETUP](docs/SETUP.md)).
3. In `content/site.json`, set `aiProvider` to its name and country, for example `{ "name": "Mistral", "country": "France" }`. Your privacy page names it.
4. Adjust `MAX_PROMPT_TOKENS` and the daily caps in `wrangler.jsonc` to its limits.

The model must support JSON-schema answers (structured outputs) for job fit. Only Groq is tested; with another provider, try both modes locally with `npm run dev:ai` before publishing.

## Costs and limits

- **Cloudflare:** the free plan covers the site, the bot check, the visitor log, the notes search and the admin login.
- **Groq** (the default AI provider): the free plan is enough to start, with limits.
  - Groq's free plan accepts about 8,000 tokens a minute. Each question sends your page content with it, so the whole site handles roughly one question a minute; visitors see a short countdown when it's busy.
  - Every request stays under `MAX_PROMPT_TOKENS` in `wrangler.jsonc`: your page content and the visitor's text always go in full, and your notes fill what's left.
  - Daily caps for the whole site, `DAILY_CAP_CHAT` and `DAILY_CAP_FIT` in `wrangler.jsonc`, keep you within the free daily allowance.
  - Groq's paid plan raises the limits a lot, at a fraction of a cent per question. Then raise `MAX_PROMPT_TOKENS` and the caps.

## Privacy

- Your content lives only in `content/` on your computer and on Cloudflare once published. Git ignores it, along with `.dev.vars`, `_private/`, the generated AI context and the build output.
- What visitors type is stored in your visitor log so you can read it on your admin page; nothing else about them is stored. The log is in the EU by default; you can choose another region, and your privacy page names it (`logRegion` in `site.json`). For the EU, `npm run deploy` checks with Cloudflare that it's true.
- Make sure your AI provider doesn't keep what visitors type, since your privacy page says so. On Groq, turn on Zero Data Retention ([SETUP](docs/SETUP.md) step A).
- Keys never go in code: you store them yourself with `npx wrangler secret put` ([SETUP](docs/SETUP.md)).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Preview at http://localhost:4321 with sample AI answers. Updates as you edit. |
| `npm run dev:ai` | The full site with the real AI at http://localhost:8787. Rerun after content changes. |
| `npm run content` | Check your content files. |
| `npm run build` | Build the site into `dist/`. |
| `npm run deploy` | Check, build and publish the site and the admin page. |
| `npm run admin:dev` | Your admin page locally at http://localhost:8788, on the local test log. |
| `npm run db:local` | Prepare the local test log. |
| `npm run db:live` | Create or update the live visitor log's table (when setting up, and after an update that changes it). |
| `npm run db:show` | Print the newest entries of the local test log. |
| `npm run check` | Type-check everything. |

## Under the hood

- [docs/SPEC.md](docs/SPEC.md): the design and the decisions behind it.
- [docs/SETUP.md](docs/SETUP.md): accounts, keys and going live.
- `CLAUDE.md`: instructions for Claude Code, if you change the site with it. It keeps Claude away from your keys and your private content.

## License

MIT, see [LICENSE](LICENSE).
