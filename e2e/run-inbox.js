// Email inbox: connect Gmail (mocked Google), review emails, import or skip.
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const APP = "http://localhost:3100";
const MOCK = "http://localhost:54321";
const SHOTS = path.join(__dirname, "shots-inbox");
const FIX = path.join(__dirname, "fixtures");
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const consoleErrors = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    console.log(`PASS  ${name} (${Date.now() - t}ms)`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}\n      ${String((err && err.stack) || err).split("\n").slice(0, 4).join("\n      ")}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const state = async () => (await fetch(`${MOCK}/__state`)).json();
async function waitFor(fn, timeout = 15000, label = "condition") {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  const inbox = page.getByRole("dialog", { name: "Inbox" });
  const email = (subject) => inbox.getByRole("listitem", { name: subject });

  await step("anonymous inbox calls are refused", async () => {
    assert((await fetch(`${APP}/api/inbox/sync`, { method: "POST" })).status === 401, "sync 401");
    assert((await fetch(`${APP}/api/inbox/import`, { method: "POST", body: "{}" })).status === 401, "import 401");
  });

  await step("sign in: not connected, so no inbox strip", async () => {
    await page.goto(APP + "/login");
    await page.getByLabel("Email").fill("luca@tiltedi.com");
    await page.getByLabel("Password").fill("correct horse battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(APP + "/");
    await page.getByText("No documents yet").waitFor();
    assert(!(await page.getByText(/to review/).count()), "no strip");
    assert((await state()).gmailCalls === 0, "no Gmail calls while not connected");
  });

  await step("connect the mailbox from the account menu (read-only, encrypted token)", async () => {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("dialog", { name: "Account" }).getByRole("link", { name: "Connect the accounting mailbox" }).click();
    await page.getByText("Inbox connected").waitFor();
    await inbox.waitFor();
    const s = await state();
    assert(s.mailConnections.length === 1 && s.mailConnections[0].email === "admin@tiltedi.com", "connection saved");
    const sealed = s.mailConnections[0].refresh_token;
    assert(sealed.startsWith("v1.") && !sealed.includes("refresh-"), `token stored encrypted: ${sealed.slice(0, 12)}…`);
    const auth = fs.readFileSync("/tmp/mock-requests.jsonl", "utf8").split("\n").filter(Boolean).map(JSON.parse).find((l) => l.kind === "google-auth");
    assert(auth.scope === "https://www.googleapis.com/auth/gmail.readonly" && auth.access === "offline", "read-only scope, offline access");
  });

  await step("emails listed for review; nothing imported yet", async () => {
    await email("Fwd: Your invoice from ACME Cloud").waitFor();
    await email("Your fuel receipt").waitFor();
    await email("Security alert").waitFor();
    const s = await state();
    assert(s.inboxItems.length === 3 && s.inboxItems.every((i) => i.status === "pending"), "3 pending items");
    assert(s.docs.length === 0 && s.anthropicCalls === 0, "nothing imported or read before approval");
    assert(await email("Fwd: Your invoice from ACME Cloud").getByRole("checkbox", { name: /invoice\.pdf/ }).isChecked(), "PDF ticked (sent as octet-stream)");
    const fuel = email("Your fuel receipt");
    assert(await fuel.getByRole("checkbox", { name: /shell\.jpg/ }).isChecked(), "photo attachment ticked");
    assert(!(await fuel.getByRole("checkbox", { name: /logo\.png/ }).isChecked()), "inline signature picture not ticked");
    const alert = email("Security alert");
    assert(!(await alert.getByRole("checkbox", { name: /The email itself/ }).isChecked()), "the email itself is never ticked by default");
    assert(await alert.getByRole("button", { name: "Import" }).isDisabled(), "nothing ticked, nothing to import");
    assert(/Forwarded message & invoice/.test((await state()).inboxItems.find((i) => i.gmail_id === "m1").snippet), "snippet entities decoded");
    await shot(page, "01-inbox");
  });

  await step("view an attachment before importing", async () => {
    const href = await email("Fwd: Your invoice from ACME Cloud").getByRole("link", { name: "View invoice.pdf" }).getAttribute("href");
    const response = await page.request.get(APP + href);
    assert(response.status() === 200 && response.headers()["content-type"] === "application/pdf", `view ${response.status()}`);
    assert(Buffer.from(await response.body()).equals(fs.readFileSync(path.join(FIX, "invoice.pdf"))), "same bytes as the email's PDF");
    assert((await state()).docs.length === 0, "viewing imports nothing");
  });

  await step("skip an email", async () => {
    await email("Security alert").getByRole("button", { name: "Skip" }).click();
    await email("Security alert").waitFor({ state: "detached" });
    assert((await state()).inboxItems.find((i) => i.gmail_id === "m3").status === "skipped", "skipped");
  });

  await step("import one: stored, read by Claude, email closed", async () => {
    await email("Fwd: Your invoice from ACME Cloud").getByRole("button", { name: "Import" }).click();
    await email("Fwd: Your invoice from ACME Cloud").waitFor({ state: "detached" });
    await waitFor(async () => (await state()).docs.some((d) => d.vendor === "ACME Cloud" && d.status === "ready"), 15000, "read");
    const s = await state();
    const doc = s.docs.find((d) => d.vendor === "ACME Cloud");
    assert(doc.mime_type === "application/pdf" && doc.file_name === "invoice.pdf", "stored as PDF");
    const stored = fs.readFileSync(path.join("/tmp/mock-state", doc.file_path.replace(/\//g, "_")));
    assert(stored.equals(fs.readFileSync(path.join(FIX, "invoice.pdf"))), "file byte-identical");
    const item = s.inboxItems.find((i) => i.gmail_id === "m1");
    assert(item.status === "imported" && item.document_ids[0] === doc.id, "item points to its document");
  });

  await step("import with the default ticks leaves the signature picture out", async () => {
    await email("Your fuel receipt").getByRole("button", { name: "Import" }).click();
    await email("Your fuel receipt").waitFor({ state: "detached" });
    await waitFor(async () => (await state()).docs.some((d) => d.vendor === "Shell" && d.status === "ready"), 15000, "shell read");
    const s = await state();
    assert(s.docs.length === 2 && !s.docs.some((d) => d.file_name === "logo.png"), "only the receipt imported");
    await inbox.getByText("Nothing to review").waitFor();
    await inbox.getByLabel("Close").click();
    assert(!(await page.getByText(/to review/).count()), "strip gone");
    await page.getByText("2 documents").waitFor();
  });

  await step("check now finds new mail; a file already in Documents isn't duplicated", async () => {
    for (const mail of [
      { id: "m4", from: "Vlabel <noreply@vlabel.example>", subject: "Registration tax", snippet: "", files: [{ name: "vlabel.jpg", mime: "image/jpeg", fixture: "vlabel.jpg" }] },
      { id: "m5", from: "Luca Pilurzu <luca@tiltedi.com>", subject: "Fwd: ACME again", snippet: "", files: [{ name: "invoice.pdf", mime: "application/pdf", fixture: "invoice.pdf" }] },
    ]) {
      await fetch(`${MOCK}/__mail`, { method: "POST", body: JSON.stringify(mail) });
    }
    await page.reload();
    await page.getByRole("button", { name: /2 emails to review/ }).waitFor();
    await page.getByRole("button", { name: /emails to review/ }).click();
    await inbox.getByRole("button", { name: "Import all (2)" }).click();
    await inbox.getByText("Nothing to review").waitFor({ timeout: 15000 });
    await page.getByText("Imported 1 document · 1 already in Documents").waitFor();
    await waitFor(async () => (await state()).docs.some((d) => d.vendor === "Vlabel" && d.status === "ready"), 15000, "vlabel read");
    const s = await state();
    assert(s.docs.length === 3, `3 documents, got ${s.docs.length}`);
    assert(s.inboxItems.find((i) => i.gmail_id === "m5").document_ids[0] === s.docs.find((d) => d.vendor === "ACME Cloud").id, "duplicate points to the existing document");
    await inbox.getByLabel("Close").click();
  });

  await step("an email without attachments can be kept as a PDF of the email", async () => {
    const text = "Kind regards,\n[image: Tilted i] <https://www.tiltedi.com/>\nLuca\n\n---------- Forwarded message ---------\nFrom: VT Accountants <fidu@vt-accountants.be>\nDate: Tue, Jul 21, 2026 at 11:57 AM\nSubject: BTW Aangifte - Tilted i - 2de kwartaal 2026\nTo: <luca@tiltedi.com>\n\nUit de aangifte blijkt dat u de volgende som aan de Staat verschuldigd bent: 2.145,43 €.\nTe betalen voor: 25 juli 2026\nIBAN: BE41 6792 0036 4210\nMededeling: +++078/7646/33429+++\nKlik hier <https://vtaccountants.winauditor.net/nl/Print/76668/DeclarationTVA#/2026-04/2026-06/> om uw betaling voor te bereiden.";
    await fetch(`${MOCK}/__mail`, { method: "POST", body: JSON.stringify({ id: "m7", from: "Luca Pilurzu <luca@tiltedi.com>", subject: "Fwd: BTW Aangifte - Tilted i - 2de kwartaal 2026", snippet: "VAT due", text, files: [{ name: "noname", mime: "image/png", fixture: "ticket.png", inline: true }] }) });
    await page.reload();
    await page.getByRole("button", { name: /1 email to review/ }).click();
    const tax = email("Fwd: BTW Aangifte - Tilted i - 2de kwartaal 2026");
    await tax.waitFor();
    const href = await tax.getByRole("link", { name: "View The email itself (as PDF)" }).getAttribute("href");
    const pdf = Buffer.from(await (await page.request.get(APP + href)).body());
    fs.writeFileSync(path.join(SHOTS, "email.pdf"), pdf);
    const { execSync } = require("child_process");
    const out = execSync(`${process.env.E2E_PYTHON || "python3"} -c "from pypdf import PdfReader; r=PdfReader('${path.join(SHOTS, "email.pdf")}', strict=True); print(len(r.pages)); print(r.pages[0].extract_text())"`).toString();
    const flat = out.replace(/\s+/g, " ");
    console.log(out.split("\n").slice(0, 12).map((l) => "      " + l).join("\n"));
    assert(flat.includes("2.145,43 €") && flat.includes("+++078/7646/33429+++"), "email text in the PDF, € kept");
    assert(flat.startsWith("1 BTW Aangifte - Tilted i - 2de kwartaal 2026 From"), `the original subject is the title: ${flat.slice(0, 80)}`);
    assert(flat.includes("VT Accountants <fidu@vt-accountants.be>") && flat.includes("Forwarded by Luca Pilurzu"), "shows the original sender and who forwarded it");
    assert(!/https?:\/\//.test(flat) && !flat.includes("Kind regards"), "no raw link addresses or forwarder signature");
    await tax.getByRole("checkbox", { name: /The email itself/ }).check();
    await tax.getByRole("button", { name: "Import" }).click();
    await tax.waitFor({ state: "detached" });
    await waitFor(async () => (await state()).docs.some((d) => d.total === 2145.43 && d.status === "ready"), 15000, "tax email read");
    const doc = (await state()).docs.find((d) => d.total === 2145.43);
    assert(doc.file_name === "BTW Aangifte - Tilted i - 2de kwartaal 2026 (email).pdf" && doc.mime_type === "application/pdf", `stored as ${doc.file_name}`);
    assert(!(await state()).docs.some((d) => d.file_name === "noname"), "layout picture left out");
    await inbox.getByLabel("Close").click();
  });

  await step("phone: inbox sheet fits", async () => {
    await fetch(`${MOCK}/__mail`, { method: "POST", body: JSON.stringify({ id: "m6", from: "Shell <noreply@shell.example>", subject: "Another fuel receipt with a rather long subject line for the phone", snippet: "", files: [{ name: "shell-2.jpg", mime: "image/jpeg", fixture: "drop-receipt.jpg" }] }) });
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: await ctx.storageState() });
    const m = await phone.newPage();
    await m.goto(APP + "/");
    await m.getByRole("button", { name: /1 email to review/ }).click();
    await m.getByRole("dialog", { name: "Inbox" }).getByRole("listitem").first().waitFor();
    await shot(m, "02-inbox-phone");
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 0, `overflow ${overflow}`);
    await phone.close();
  });

  await step("the From email button opens the inbox", async () => {
    await page.getByRole("button", { name: "Import from email" }).first().click();
    await inbox.waitFor();
    await inbox.getByLabel("Close").click();
  });

  await step("account menu: Open shows the inbox", async () => {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Open" }).click();
    await inbox.waitFor();
    await page.waitForTimeout(400);
    assert(await inbox.isVisible(), "inbox still open");
    await inbox.getByLabel("Close").click();
  });

  await step("disconnect keeps waiting emails but stops reading the mailbox", async () => {
    await page.getByRole("button", { name: "Account" }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Disconnect" }).click();
    await page.getByText("Inbox disconnected").waitFor();
    const s = await state();
    assert(s.mailConnections.length === 0, "connection removed");
    assert(s.inboxItems.some((i) => i.status === "pending"), "pending email kept");
    const calls = s.gmailCalls;
    await page.reload();
    await page.waitForTimeout(800);
    assert((await state()).gmailCalls === calls, "no Gmail calls after disconnecting");
  });

  console.log("\nconsole errors:", consoleErrors.length ? "\n  " + consoleErrors.join("\n  ") : "none");
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})();
