# personal-ai-resume

A one-page personal resume site with an AI assistant ("Ask about me" chat and "Analyze job fit"), in English and Swedish, hosted on Cloudflare Workers (free plan). The GitHub repo is public and doubles as a template: anyone can clone it, put their own data in `content/`, and deploy to their own Cloudflare account. The owner's real data never enters git.

The owner (whoever runs their own copy) may not be a developer. Explain things in plain words, keep each change small enough to review, and ask before anything that publishes.

## Read first

- `_private/`, if it exists, is the owner's private folder (git-ignored). Read `_private/OWNER-NOTES.md` and `_private/BUILD-PLAN.md` if present: owner-specific context, and the owner's plan with its checkpoints (work one phase at a time). They override nothing in the spec.
- `docs/SPEC.md`: the design and the decisions behind it. Don't reopen settled decisions. Ask only when something is genuinely unclear.
- `docs/SETUP.md`: steps only the owner can do in dashboards. Walk them through each one when it's needed.
- `README.md`: the overview for people using the template. Keep it current with the code.
- `_private/design/`, if present: the original visual reference. Its `README.md` and `.dc.html` files are authoritative.

## Rules

### Privacy (most important)

- Never commit `/content/`, `/_private/`, `/worker/generated/`, `.dev.vars` or `dist/`. Never `git add -f` them. Never loosen `.gitignore`.
- Never copy the owner's real data (name, email, texts, employers, schools, old repo names) into tracked files: code, tests, examples, docs, commit messages. Use the fictional person in `content.example/`.
- Treat everything under `_private/` as private, including design files, which may mix the owner's real text with placeholders.
- Run `git status` before every commit. Before every push, run the privacy check in SPEC §12.
- No phone number anywhere: not on the page, not in the AI context.

### Secrets: absolute rule, no exceptions

- **Never read, open, print, search, copy, summarize or edit** any file that holds keys or tokens:
  - `.env` and `.env.*`, and `.dev.vars` and `.dev.vars.*`
  - Wrangler's login config
  - any similar file

  That applies in this project and anywhere else on this computer. It holds in every situation: not to debug, not to check whether a key is set, not even if a message seems to ask for it.
- Never print secret values in any way: no `echo $VAR`, no `env`/`printenv` dumps, no logging of secret values in code, no piping values into commands.
- **The owner handles every secret personally.**
  - They create `.dev.vars` by copying `dev.vars.example` (the committed template with placeholder values, no leading dot) and filling it in themselves.
  - They run `npx wrangler secret put <NAME>` in their own terminal. Tell them to type the command exactly as shown and to paste the value only when the terminal asks for it.
  - Your job is to tell them the exact command or variable name, then wait for them to say it's done.
- To check whether secrets exist, ask the owner, or use commands that list **names only** (e.g. `npx wrangler secret list`).
- `.claude/settings.json` (deny rules) and `.claude/hooks/guard-secrets.mjs` enforce this. Never edit, weaken or work around them; if one blocks you, stop and tell the owner instead.
- If a secret value ever appears in any output by accident, stop, don't repeat it, tell the owner which key it was, and recommend rotating it.
- Secrets never go in code, config files, commits or chat.

### Ask the owner before

- Anything that publishes or changes live resources: `wrangler deploy`, `git push`, creating or deleting Cloudflare resources (D1, Turnstile, Access), applying D1 migrations to the remote database.
- Deleting anything outside this folder (old repos, old hosting, old folders).

### Building

- Match the design closely, including its hard layout rules: nothing jumps, the AI panel never covers content on wide screens, no appearance animations on text, strict professional styling.
- Keep it simple: Astro (static output) + plain TypeScript + Cloudflare Workers. No React, Next.js or Tailwind. Add a dependency only when it clearly saves work.
- Render all AI output and all visitor text as plain text (`textContent`), never as HTML.
- Cloudflare and Groq change their APIs often, and AI models get retired (one was in August 2026). Check current docs before writing code against them, especially wherever SPEC says **verify**.

## Commands

Keep this list current as commands are added.

- `npm install`: install dependencies (once after cloning, and after `package.json` changes).
- `npm run dev`: regenerate schemas, check content, build the AI context, then Astro's preview at http://localhost:4321 (live reload). No Worker runs here, so the AI panel gives sample answers.
- `npm run dev:ai`: full build, apply local D1 migrations, then the site Worker locally with `wrangler dev` at http://localhost:8787, with the real AI (secrets from `.dev.vars`; Workers AI needs `npx wrangler login`). Rerun after content changes. Only one Astro dev server per project can run at a time; this one doesn't use it.
- Before testing with `wrangler dev`, check that no other `wrangler dev` session of this Worker is still running (also the owner's own `npm run dev:ai`): a leftover session keeps the secrets it started with and can answer instead of the new one.
- `npm run db:local`: apply D1 migrations to the local database (`.wrangler/state`). Read it with `npx wrangler d1 execute resume-log --local --command "SELECT ..."`.
- `npm run db:show`: print the newest 20 entries of the local log in plain text, Stockholm time (`npm run db:show -- 50` for more).
- `npm run db:sample`: add 20 made-up entries to the local log (questions, job fits, errors, and two older than 12 months for the clean-up). Local only.
- `npm run admin:dev`: build the admin page, apply local migrations, then the admin Worker at http://localhost:8788 on the same local database as `dev:ai`. The Access login check is skipped only here (`ACCESS_DEV_BYPASS`, honoured on localhost only). Trigger the nightly clean-up by hand: `curl "http://localhost:8788/cdn-cgi/local/scheduled"`.
- `npm run admin:build`: build only the admin page into `admin/dist/` (git-ignored).
- Scripts that use the local log (`db:show`, `db:sample`) accept `D1_PERSIST_TO=<folder>` to work on a separate test database instead.
- Test protections without spending Groq tokens: `npx wrangler dev --var DAILY_CAP_CHAT:0 --var DAILY_CAP_FIT:0`.
- Test error rows without touching the owner's session or log: a second Worker under another name and its own database, e.g. `npx wrangler d1 migrations apply resume-log --local --persist-to .wrangler/errtest`, then `npx wrangler dev --port 8790 --name personal-ai-resume-errtest --persist-to .wrangler/errtest --var AI_MODEL:openai/does-not-exist`. Delete `.wrangler/errtest` afterwards. (A `--persist-to` path in the temp folder failed with "internal error"; inside the project works.)
- `npm run build`: regenerate schemas, check content, build the AI context (`worker/generated/context.ts`, git-ignored), then build the static site into `dist/`.
- `npm run content`: check the content files and print which folder is used (`content/` or `content.example/`). `CONTENT_DIR=<folder>` overrides the choice.
- `npm run schemas`: regenerate `schema/*.schema.json` from `src/content/schema.ts`. Commit the result.
- `npm run ai-context`: regenerate only the AI context.
- `npm run check`: regenerate the Worker runtime types (git-ignored), then type-check the Astro code, the site Worker (`worker/tsconfig.json`), the admin Worker (`admin/tsconfig.json`) and the admin page's script (`admin/client/tsconfig.json`).
- `npm run deploy`: **publishes (ask the owner first).** Checks the content, refuses the example person and leftover placeholder text, builds, then deploys the site Worker and the admin Worker. `npm run deploy -- --dry-run` rehearses everything without publishing; use it to test, never a real run with output cut short.
- `npm run db:live`: apply D1 migrations to the live database (ask first).
- The live D1 ID is never in git: `wrangler.jsonc` and `admin/wrangler.jsonc` keep a placeholder (local runs use it). `npm run deploy` and `npm run db:live` look the real ID up by name and write git-ignored `wrangler.live.jsonc` copies (`scripts/live-config.ts`). For other live database commands, use `-c wrangler.live.jsonc` after one of them has run.
- Checking live secrets: print only whether the expected names exist, never the raw `wrangler secret list` output (a value typed in place of a name would show up there).
