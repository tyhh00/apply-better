// End-to-end: a throwaway Chromium with the real extension, the real bridge, and
// three local application forms. Drives the side panel like a person would.
//
//   npm run e2e                  # uses a fake agent (fast, no account needed)
//   E2E_AGENT=claude npm run e2e # uses your real Claude Code
//   HEADED=1 npm run e2e         # watch it
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(repo, "test/e2e/out");
const AGENT = process.env.E2E_AGENT ?? "fake";
const AGENT_TIMEOUT = AGENT === "fake" ? 20_000 : 300_000;
const t0 = Date.now();
const step = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const fail = (s) => {
  throw new Error(`FAILED: ${s}`);
};
const expect = (cond, s) => (cond ? step(`  ✓ ${s}`) : fail(s));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

step("build (e2e)");
execFileSync("node", [path.join(repo, "scripts/build.mjs")], { env: { ...process.env, APPLY_BETTER_E2E: "1" }, stdio: "inherit" });
const dist = path.join(repo, "dist-e2e");

const tmp = mkdtempSync(path.join(os.tmpdir(), "apply-better-e2e-"));
const profile = path.join(tmp, "profile");
const home = path.join(tmp, "home");
mkdirSync(profile);
step(`connect bridge (${AGENT})`);
execFileSync(
  "node",
  [path.join(repo, "bridge/install.mjs"), "--home", home, "--user-data-dir", profile, "--quiet", ...(AGENT === "fake" ? ["--claude", path.join(repo, "test/fake/fake-claude.mjs")] : [])],
  { stdio: "inherit" },
);

const fixtures = path.join(repo, "test/e2e/fixtures");
const server = createServer((req, res) => {
  try {
    const file = path.join(fixtures, path.normalize(new URL(req.url, "http://x").pathname).replace(/^\/+/, ""));
    if (!file.startsWith(fixtures)) throw new Error("outside");
    res.setHeader("content-type", file.endsWith(".css") ? "text/css" : "text/html");
    res.end(readFileSync(file));
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: !process.env.HEADED,
  viewport: { width: 1000, height: 900 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const extId = new URL(sw.url()).host;
  const { id: expectedId } = JSON.parse(readFileSync(path.join(repo, "src/extension-key.json"), "utf8"));
  expect(extId === expectedId, `extension loaded with its fixed id ${extId}`);

  const form = await ctx.newPage();
  await form.goto(`${base}/northwind.html`);
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  const tabId = await panel.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes("northwind"))?.id);
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html?tab=${tabId}`);
  // Full-page captures stitch the sticky header into the middle; unstick it for screenshots only.
  await panel.addStyleTag({ content: ".top{position:static!important}" });
  const shot = (name) => panel.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  const storage = () => panel.evaluate(() => chrome.storage.local.get(null));
  const answersOf = async () => Object.values((await storage()).answers ?? {});

  // 1. Turn the site on
  step("turn on for the site");
  await panel.getByRole("button", { name: "Turn on for 127.0.0.1" }).waitFor();
  await shot("01-turn-on");
  await panel.getByRole("button", { name: "Turn on for 127.0.0.1" }).click();
  await panel.getByText("10 questions on this page").waitFor({ timeout: 10_000 });
  expect(true, "found 10 questions: 6 to type, 4 to pick (the password box is left out)");
  await shot("02-questions-found");

  // 2. Write answers by hand; they are remembered
  step("type answers into the Northwind form");
  await form.bringToFront();
  await form.fill("#name", "Sam Rivera");
  await form.fill("#email", "sam@example.com");
  await form.fill("#li", "https://linkedin.com/in/samrivera");
  await form.fill("#pw", "hunter2-secret");
  await form.fill(
    "#why",
    "I've spent four years building internal tools that people actually like using, and Northwind is the first company I've seen treat ops software like a consumer product. I want to be where that bet gets made.",
  );
  await form.locator("[role=listitem] textarea").fill(
    "I rebuilt our checkout at Shopwise. I owned the plan, wrote most of the code, and ran the rollout. Checkout time dropped 40% and failed payments fell 18% in the first quarter.",
  );
  await form.locator("[contenteditable]").click();
  await form.keyboard.type("I'm based in Singapore and can overlap with US mornings.");
  step("pick answers: Zoho-style radio, checkboxes, a silent select2-style dropdown, Google-Forms-style radio");
  await form.click("label[for=Radio1_1]");
  await form.getByLabel("Engineering").check();
  await form.getByLabel("Product").check();
  await form.click("#hear-combo");
  await form.click("#hear-menu >> text=Hacker News");
  await form.click("#reloc [data-value=Yes]");
  await form.locator("h1").click();
  await form.waitForTimeout(1800);
  let answers = await answersOf();
  expect(answers.length === 10, `10 answers remembered (got ${answers.length})`);
  const said = (q) => answers.find((a) => a.question === q)?.answer;
  expect(said("Ethnicity") === "Chinese", `Ethnicity → ${said("Ethnicity")} (hidden Zoho-style radio)`);
  expect(said("Which roles interest you?") === "Engineering; Product", `Roles → ${said("Which roles interest you?")}`);
  expect(said("How did you hear about us?") === "Hacker News", `Heard via → ${said("How did you hear about us?")} (dropdown changed with no event)`);
  expect(said("Are you open to relocation?") === "Yes", `Relocation → ${said("Are you open to relocation?")} (radio with no input)`);
  expect(!JSON.stringify(answers).includes("hunter2"), "the password was not saved");
  expect(answers.every((a) => a.source === "you"), "all marked as your own writing");
  expect(answers.some((a) => a.question === "Tell us about a project you're proud of What was your part, and what changed because of it?"), "label-less question read from its block");
  await panel.bringToFront();
  await panel.getByRole("tab", { name: /Answers/ }).click();
  await panel.getByText("Sam Rivera").waitFor();
  await shot("03-answers-pool");

  // 3. A project and some facts
  step("make a project and add facts");
  await panel.getByRole("tab", { name: "Projects" }).click();
  await panel.getByRole("button", { name: "+ New project" }).click();
  await panel.getByPlaceholder("e.g. YC W27 application").fill("Acme · Senior Engineer");
  await panel.getByPlaceholder(/What is this application/).fill("Payments team at Acme. They care about reliability at scale and owning outcomes end to end. Lead with the Shopwise checkout rebuild.");
  await panel.getByRole("button", { name: "Save" }).click();
  await panel.getByText("Active").first().waitFor();
  await shot("04-project");
  await panel.getByRole("tab", { name: "Settings" }).click();
  await panel.getByText(AGENT === "fake" ? "9.9.9 (Fake Claude)" : /Claude Code\)/).waitFor({ timeout: 30_000 });
  expect(true, "Settings shows the bridge connected with Claude Code");
  await panel.getByPlaceholder(/Name, email, LinkedIn/).fill("Sam Rivera, product engineer. 6 years: Shopwise (payments, 4 yrs), Lumen (internal tools, 2 yrs). Python, TypeScript, Postgres.");
  await panel.getByRole("heading", { name: "Settings" }).click();
  await shot("05-settings");

  // 4. A new application: answered-before + the agent
  step("open the Acme form");
  await form.goto(`${base}/acme.html`);
  await panel.getByRole("tab", { name: "Fill" }).click();
  await panel.getByText("8 questions on this page").waitFor({ timeout: 10_000 });
  const before = await panel.getByText(/^Answered before/).count();
  expect(before >= 4, `${before} questions already answered before (name, email, LinkedIn, ethnicity)`);
  await shot("06-answered-before");
  for (let i = 0; i < 4; i++) await panel.getByRole("button", { name: "Use it" }).first().click();
  await form.waitForTimeout(400);
  expect((await form.inputValue("#l")) === "https://linkedin.com/in/samrivera", "one click put the LinkedIn URL in, no agent needed");
  expect((await form.inputValue("#n")) === "Sam Rivera", "and the name");
  expect(await form.isChecked("#eth_1"), "and picked Chinese on a different form's Ethnicity radios");

  step("fill the rest with the agent");
  await panel.getByRole("button", { name: /Fill 4 with my agent/ }).click();
  await panel.getByText("Reading how you write…").waitFor();
  await shot("07-reading");
  const planStart = Date.now();
  await Promise.race([
    panel.getByText("A few things before it writes").waitFor({ timeout: AGENT_TIMEOUT }),
    panel.getByText(/answers ready/).waitFor({ timeout: AGENT_TIMEOUT }),
  ]);
  step(`  plan took ${((Date.now() - planStart) / 1000).toFixed(1)}s`);
  if (await panel.getByText("A few things before it writes").isVisible()) {
    const cards = panel.locator(".card:has(textarea)");
    const n = await cards.count();
    step(`  the agent asked ${n} question(s): ${(await cards.locator("h3").allTextContents()).join(" | ")}`);
    for (let i = 0; i < n; i++) {
      const chip = cards.nth(i).locator(".chip").first();
      if (await chip.count()) await chip.click();
      else await cards.nth(i).locator("textarea").fill("I'd start with the retry logic for failed card payments, since that's where Shopwise lost the most revenue.");
    }
    await shot("08-asks-first");
    await panel.getByRole("button", { name: "Write my answers" }).click();
  }
  const draftStart = Date.now();
  await panel.getByText(/answers ready/).waitFor({ timeout: AGENT_TIMEOUT });
  step(`  drafting took ${((Date.now() - draftStart) / 1000).toFixed(1)}s`);
  await shot("09-drafts");
  await panel.getByRole("button", { name: "Put all in the form" }).click();
  await form.waitForTimeout(500);
  const filled = [await form.inputValue("#w"), await form.inputValue("#i"), await form.inputValue("#d")];
  expect(filled.every((v) => v.trim().length > 10), "all three long answers are in the Acme form");
  expect(filled.every((v, i) => v.length <= [800, 1200, 800][i]), "each stays inside the box's character limit");
  const reloc = (await form.isChecked("#reloc-yes")) ? "Yes" : (await form.isChecked("#reloc-no")) ? "No" : "(left empty)";
  if (AGENT === "fake") expect(reloc === "Yes", "the agent's pick for relocation is ticked in the form");
  else step(`  relocation: the agent picked ${reloc}`);
  await form.bringToFront();
  await form.screenshot({ path: path.join(out, "10-acme-form-filled.png"), fullPage: true });
  await panel.bringToFront();
  await form.waitForTimeout(1800);
  answers = await answersOf();
  const s = await storage();
  const acmeProject = Object.values(s.projects)[0];
  expect(answers.some((a) => a.source === "agent" && a.site === "127.0.0.1" && a.projectId === acmeProject.id), "kept drafts are remembered under the Acme project");
  if (AGENT === "fake" || answers.some((a) => a.source === "told")) expect(answers.some((a) => a.source === "told"), "what you told the agent is remembered");

  // 5. The next application asks less
  step("open the Globex form: it should need less from you now");
  await form.goto(`${base}/globex.html`);
  await panel.getByText("2 questions on this page").waitFor({ timeout: 10_000 });
  await panel.getByRole("button", { name: "+ New" }).click();
  await panel.waitForFunction(() => document.querySelector("select[aria-label='Project for this form']")?.selectedOptions[0]?.text === "Globex Builders Fellowship");
  expect(true, "one click started a 'Globex Builders Fellowship' project from the page");
  await shot("10b-globex-new-project");
  await panel.getByRole("button", { name: /Fill 2 with my agent/ }).click();
  await Promise.race([
    panel.getByText("A few things before it writes").waitFor({ timeout: AGENT_TIMEOUT }),
    panel.getByText(/answers ready/).waitFor({ timeout: AGENT_TIMEOUT }),
  ]);
  const asked = (await panel.getByText("A few things before it writes").isVisible()) ? await panel.locator(".card:has(textarea)").count() : 0;
  step(`  the agent asked ${asked} question(s) this time`);
  if (AGENT === "fake") expect(asked === 0, "nothing to ask: it already knows your proudest result");
  if (asked) {
    await shot("11-globex-asks");
    await panel.getByRole("button", { name: "Skip and write anyway" }).click();
  }
  await panel.getByText(/answers ready/).waitFor({ timeout: AGENT_TIMEOUT });
  await shot("11-globex-drafts");

  // 6. Voices: check and rewrite
  step("voices: check and rewrite a piece of writing");
  await panel.getByRole("tab", { name: "Voices" }).click();
  await panel.getByRole("button", { name: /Ownership/ }).click();
  await panel.getByPlaceholder("Paste or write something").fill("We were involved in a project that helped improve the checkout flow, and the team saw some good results.");
  await panel.getByRole("button", { name: "Check as Ownership" }).click();
  await panel.locator(".score").waitFor({ timeout: AGENT_TIMEOUT });
  await panel.getByRole("button", { name: "Rewrite" }).click();
  await panel.getByRole("button", { name: "Use this" }).waitFor({ timeout: AGENT_TIMEOUT });
  await shot("12-voices");
  expect(true, "audit score and rewrite shown");

  // 7. Turning a site off stops remembering
  step("turn the site off");
  await panel.getByRole("tab", { name: "Settings" }).click();
  await panel.getByRole("button", { name: "Turn off" }).click();
  await panel.getByText("None yet. Open a form").waitFor();
  await panel.getByRole("tab", { name: "Fill" }).click();
  await panel.getByRole("button", { name: "Turn on for 127.0.0.1" }).waitFor();
  const count = (await answersOf()).length;
  await form.fill("#a", "This should not be saved.");
  await form.locator("h1").click();
  await form.waitForTimeout(1800);
  expect((await answersOf()).length === count && !JSON.stringify(await answersOf()).includes("should not be saved"), "nothing saved after turning it off");

  step(`ALL PASSED · screenshots in ${path.relative(repo, out)}/`);
} finally {
  await ctx.close();
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
