# Setup: accounts, keys and going live

The steps you do in your AI provider's and Cloudflare's dashboards, in order. The README has the overview; this is the detail. Cloudflare and Groq rename menus from time to time (screens below as of late 2026), so if a label doesn't match, look for the closest one or check their docs.

If you build with Claude Code, it can walk you through these steps. It never handles your keys: the rules in `CLAUDE.md` and the guard in `.claude/` stop it from opening secret files.

## How secrets work (read this first)

You handle every key yourself, in two places, and never paste one into a chat, an issue or a commit.

- **On your computer (for testing):** copy `dev.vars.example` to a new file named `.dev.vars` (with the leading dot) in the same folder, fill in the values and save. Git ignores it.
- **On Cloudflare (for the live site):** in your own terminal, run `npx wrangler secret put <NAME>`.
  - Type the command **exactly as shown**: the part after `secret put` is a fixed name in capital letters, never your key.
  - Only when the terminal asks `Enter a secret value:` do you paste the key, then press Enter. It stays hidden.
  - To check which secrets exist, list names only. If a key ever appears where a name should be, delete that entry and replace the key at its provider.

**What `.dev.vars` contains for local testing:** three lines (comments are optional):

```
AI_API_KEY="your Groq key"
TURNSTILE_SECRET="1x0000000000000000000000000000000AA"
PASS_SIGNING_KEY="a long random string"
```

- `TURNSTILE_SECRET` locally is Cloudflare's public test key (it always passes); the real one is for the live site only (step E). Local runs also use Cloudflare's test site key automatically.
- For `PASS_SIGNING_KEY`, run `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"` and paste what it prints.
- Each name only once. If a name appears twice, the lower line wins.
- After changing `.dev.vars`, stop every running `npm run dev:ai` (Ctrl+C) and start it again: a running session keeps the values it started with.

## A. The AI provider (Groq by default)

The site works with any provider that offers an OpenAI-compatible chat API; it comes set up for Groq, the steps below. For another provider, see "Using another AI provider" in the README, then do the equivalent of steps 2, 4 and 5 there.

1. Create an account or log in at https://console.groq.com.
2. **Key:** create one under **API Keys**. Put it in `.dev.vars` as `AI_API_KEY` for local testing; the live site gets it in step F.
3. **Limits:** the limits page in Settings shows `openai/gpt-oss-120b`'s **tokens per minute**. On the free plan that's 8,000: roughly one question a minute for the whole site; `MAX_PROMPT_TOKENS` in `wrangler.jsonc` keeps every request below it. On a paid plan, raise `MAX_PROMPT_TOKENS` and the daily caps.
4. **Billing:** on the free plan Groq simply stops answering at a limit, so nothing can be charged. If you add a payment method, set a monthly spending limit.
5. **Zero Data Retention:** in **Settings → Data Controls**, turn on **Zero Data Retention**. By default Groq may keep what visitors type for up to 30 days (in the US) to investigate errors or abuse; with this on, it keeps nothing. The privacy page says Groq doesn't keep visitors' text, so turn it on before going live. It only switches off batch jobs and fine-tuning, which this site doesn't use.

## B. Connect your terminal to Cloudflare

Create a Cloudflare account if you don't have one, then run `npx wrangler login` in the project folder. A browser tab opens; log in and click **Allow**. Local runs need this too, because the notes search uses Cloudflare's Workers AI.

## C. Your `workers.dev` address

The site will be at `personal-ai-resume.<your-subdomain>.workers.dev`, and the admin page at `personal-ai-resume-admin.<your-subdomain>.workers.dev`.

1. In the Cloudflare dashboard, open **Workers & Pages** and find **Subdomain** (on the right, under account details).
2. If it contains your name and you'd rather it didn't, change it now to a neutral name you can use for all your projects (for example `my-projects`). It applies to every Worker on the account; Pages projects aren't affected. Changing it later breaks existing links.

## D. The visitor log database

Create it once. Its location can't be changed later. The EU is the default, and your privacy page says so:

```
npx wrangler d1 create resume-log --jurisdiction=eu
npm run db:live
```

The first creates the database, the second its table. Leave the placeholder ID in `wrangler.jsonc` as it is: `npm run deploy` finds the database by its name.

Prefer another region? Leave out `--jurisdiction=eu` (Cloudflare places it near you, or add a hint such as `--location=wnam` for western North America), and set `"logRegion"` in `content/site.json` to where it is, for example `"USA"`. Your privacy page then names that region. `npm run deploy` refuses to publish `"EU"` unless the database really is restricted to the EU.

## E. Turnstile (the bot check)

1. In the Cloudflare dashboard, open **Turnstile** and add a widget. Choose the **manual** setup, not an AI-assisted one: the site already has the bot check built in, and an assistant's prompt may contain your secret key.
2. Name it `personal-ai-resume`. Hostname: your site's address from step C, without `https://`.
3. Widget mode: **Managed**. Visitors see nothing unless Cloudflare needs a click; Invisible mode would require extra text on your privacy page. Leave pre-clearance off.
4. You get two keys, both starting with `0x4AAAA`:
   - the **site key** (public): put it in `content/site.json` as `turnstileSiteKey`;
   - the **secret key** (the longer one): stored in step F. Copy it with its copy button. If the live chat later says it couldn't confirm you're a person, the site key probably went in instead.

## F. Secrets on Cloudflare

In your terminal, run each line **exactly as written**, and paste the value only when asked:

```
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put AI_API_KEY
npx wrangler secret put PASS_SIGNING_KEY
```

- `TURNSTILE_SECRET`: the secret key from step E.
- `AI_API_KEY`: your AI provider's key.
- `PASS_SIGNING_KEY`: a new random string (the command under "How secrets work").

If it asks whether to create a Worker called `personal-ai-resume`, answer `y`: the site isn't published yet.

## G. Publish

```
npm run deploy
```

It checks your content (it refuses the example person and leftover placeholder text), builds, and publishes the site and the admin page. Run it again after every content change. `npm run deploy -- --dry-run` rehearses without publishing. The admin page refuses everyone until step H.

## H. Private admin login (Cloudflare Access)

1. In the Cloudflare dashboard, open **Zero Trust** (also called Cloudflare One).
   - The first time, it asks for a team name or assigns a random one (like `quiet-river-1a2b`). Anything neutral is fine; it's under **Settings**. Your login page will be `<team>.cloudflareaccess.com`.
   - Choose the **Free** plan (up to 50 users). Cloudflare may ask for a card; it isn't charged.
2. **Login method:** under **Integrations → Identity providers** (older menus: **Settings → Authentication**), click **Add an identity provider** and choose **One-time PIN**: an emailed 6-digit code. Leave the existing "Cloudflare" entry.
3. **A rule for you only:** under **Access controls → Policies**, add a policy:
   - name `Owner only`, action **Allow**;
   - **Include → Emails →** your email address, nothing else.
   - Don't use the ready-made "Email domain" policy: with a Gmail address it would let in anyone with Gmail.
4. **Protect the admin Worker:** in **Workers & Pages**, open `personal-ai-resume-admin` → **Settings → Domains & Routes**. On the **Production** row, click **Enable Access →**, then **Protect this Worker behind Access**:
   - **Scope: All traffic** (the default, "Previews only", would leave the admin page open);
   - **Authentication policy:** search for and pick `Owner only`;
   - click **Apply Access**. Leave the Production switch on and the Preview row off.
5. **Let the admin page check the login itself.** It needs two values (not secrets): your **team domain** (`<team>.cloudflareaccess.com`) and the **Application Audience (AUD) tag** (**Access controls → Applications →** the admin app's settings). Store them on the admin Worker, which keeps them out of git and across deploys:

   ```
   npx wrangler secret put ACCESS_TEAM_DOMAIN -c admin/wrangler.jsonc
   npx wrangler secret put ACCESS_AUD -c admin/wrangler.jsonc
   ```
6. **Test it** in a private browser window: the admin address shows Cloudflare's login, you get a code by email, and you land on the admin page with your visitor log.
