// PreToolUse hook: blocks any tool call that names a secret file
// (.env*, .dev.vars*, Wrangler's login config). Exit code 2 blocks the call
// and tells Claude why. dev.vars.example (no leading dot) stays allowed.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const t = input.tool_input ?? {};
const text = [t.command, t.file_path, t.path, t.pattern, t.glob]
  .filter((v) => typeof v === "string")
  .join("\n");

const before = String.raw`(^|[\s/\\'"=:(*])`;
const after = String.raw`(?=$|[\s/\\'";|&)<>,*])`;
const secretFile = new RegExp(
  before + String.raw`(\.env(\.[\w-]+)?|\.dev\.vars(\.[\w-]+)?)` + after,
  "i",
);
const wranglerLogin = /\.wrangler[\/\\]config/i;

if (secretFile.test(text) || wranglerLogin.test(text)) {
  console.error(
    "Blocked: this touches a secret file (.env, .dev.vars or Wrangler's login config). " +
      "Secrets are off-limits in every situation. Tell the owner what is needed and let them handle it.",
  );
  process.exit(2);
}
