// Bank reconciliation + bookkeeping walkthrough against the mock backend.
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const APP = "http://localhost:3100";
const MOCK = "http://localhost:54321";
const DIR = __dirname;
// Python with openpyxl, pypdf and pillow validates the exported files (see e2e/README.md).
const PY = process.env.E2E_PYTHON || "python3";
const SHOTS = path.join(DIR, "shots-bank");
const DL = path.join(DIR, "downloads-bank");
const FIX = path.join(DIR, "fixtures");
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });

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
// Simulates dragging a file from the desktop onto the page.
async function dropFile(page, file, type, target) {
  const data = fs.readFileSync(file).toString("base64");
  const handle = target ? await target.elementHandle() : null;
  await page.evaluate(
    async ({ data, name, type, el }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type }));
      const node = el ?? document.body;
      const fire = (kind) => node.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: dt }));
      fire("dragenter");
      fire("dragover");
      await new Promise((r) => setTimeout(r, 150));
      window.__overlay = document.body.innerText.includes("Drop ");
      window.__highlight = Boolean(el && el.className.includes("ring-accent"));
      fire("drop");
    },
    { data, name: path.basename(file), type, el: handle },
  );
  assert(await page.evaluate(() => window.__overlay), "drop overlay shown while dragging");
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Sets exactly `wanted` ("YYYY-MM") in the download dialog, whatever it opened with.
async function pickMonths(dlg, wanted) {
  const prev = dlg.getByRole("button", { name: "Previous year" });
  const next = dlg.getByRole("button", { name: "Next year" });
  while (await prev.isEnabled()) await prev.click();
  for (;;) {
    for (const btn of await dlg.getByRole("button", { name: /^\w+ \d{4}, / }).all()) {
      const [name, year] = (await btn.getAttribute("aria-label")).split(",")[0].split(" ");
      const month = `${year}-${String(MONTH_NAMES.indexOf(name) + 1).padStart(2, "0")}`;
      if ((await btn.getAttribute("aria-pressed")) !== String(wanted.includes(month))) await btn.click();
    }
    if (!(await next.isEnabled())) return;
    await next.click();
  }
}

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await step("sign in and add five receipts", async () => {
    await page.goto(APP + "/login");
    await page.getByLabel("Email").fill("luca@tiltedi.com");
    await page.getByLabel("Password").fill("correct horse battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(APP + "/");
    await page.locator("input[type=file][multiple]").first().setInputFiles(["invoice.pdf", "receipt-photo.jpg", "ticket.png", "page1.jpg"].map((f) => path.join(FIX, f)));
    await waitFor(async () => (await state()).docs.filter((d) => d.status === "ready").length === 4, 20000, "4 docs read");
    await page.locator("input[type=file][capture]").first().setInputFiles(path.join(FIX, "page2.jpg"));
    const scan = page.getByRole("dialog", { name: "Scan" });
    await scan.getByText("1 page").waitFor();
    await scan.getByRole("button", { name: "Save" }).click();
    await waitFor(async () => (await state()).docs.filter((d) => d.status === "ready").length === 5, 20000, "5 docs read");
    const s = await state();
    assert(s.docs.every((d) => typeof d.ai_cost_usd === "number" && d.ai_cost_usd > 0), "cost recorded on every read");
    console.log("      cost per read:", s.docs[0].ai_cost_usd);
  });

  await step("account dialog shows reading cost", async () => {
    await page.reload();
    await page.getByRole("button", { name: "Account" }).click();
    const dlg = page.getByRole("dialog", { name: "Account" });
    await dlg.getByText("Reading cost this month").waitFor();
    const text = await dlg.innerText();
    assert(/\$0\.01[67]/.test(text) && /5 documents/.test(text), `cost text: ${text}`);
    await dlg.getByLabel("Close").click();
  });

  await step("bank tab: empty state", async () => {
    await page.getByRole("link", { name: "Bank" }).click();
    await page.waitForURL(APP + "/bank");
    await page.getByText("Import a bank statement").waitFor();
    await shot(page, "01-bank-empty");
  });

  await step("import ING CSV: 7 lines, nothing linked until approved", async () => {
    await page.locator("input[type=file]").first().setInputFiles(path.join(FIX, "ing.csv"));
    await page.getByText("Imported 7 lines").waitFor();
    await page.waitForTimeout(1000);
    assert((await state()).txs.every((t) => t.status === "unmatched"), "no silent linking");
    const tabs0 = await page.getByRole("tablist").innerText();
    console.log("      tabs:", tabs0.replace(/\n/g, " "));
    assert(/Missing receipt\s*3/.test(tabs0) && /To approve\s*4/.test(tabs0) && /Matched\s*0/.test(tabs0), "tab counts before approval");
    const badge = await page.getByRole("link", { name: /Bank/ }).innerText();
    assert(/4/.test(badge), `bank badge: ${badge}`);
    await page.getByRole("tab", { name: /To approve/ }).click();
    await shot(page, "02a-to-approve");
    await page.getByRole("button", { name: "Approve all 2" }).click();
    await waitFor(async () => (await state()).txs.filter((t) => t.status === "matched").length === 2, 10000, "2 approved");
    const s = await state();
    const byName = Object.fromEntries(s.txs.map((t) => [t.counterparty, t]));
    assert(byName["Bar Centrale Amsterdam"].amount === -49.9 && byName["Bar Centrale Amsterdam"].booked_on === "2026-08-04", "ING parsed");
    assert(byName["Client Studio BV"].amount === 2500, "incoming parsed with thousands");
    const barDoc = s.docs.find((d) => d.vendor === "Bar Centrale");
    assert(byName["Bar Centrale Amsterdam"].document_id === barDoc.id && byName["Bar Centrale Amsterdam"].matched_by === "auto", "bar auto matched");
    assert(byName["AMAZON EU SARL"].status === "matched", "amazon auto matched");
    assert(byName["NS Groep IZ NS Reizigers"].status === "unmatched", "NS not auto (20 days late)");
    await page.getByRole("tab", { name: /Missing receipt/ }).waitFor();
    const tabs = await page.getByRole("tablist").innerText();
    assert(/Missing receipt\s*3/.test(tabs) && /To approve\s*2/.test(tabs) && /Matched\s*2/.test(tabs), "tab counts");
    await shot(page, "02-missing");
  });

  await step("re-import by dropping the CSV on the page is deduplicated", async () => {
    await dropFile(page, path.join(FIX, "ing.csv"), "text/csv");
    await page.getByText("Nothing new · 7 already here").waitFor();
    assert((await state()).txs.length === 7, "still 7");
  });

  await step("headerless ABN file mapped by Claude, then undo", async () => {
    await page.locator("input[type=file]").first().setInputFiles(path.join(FIX, "abn.txt"));
    await page.waitForTimeout(2500);
    console.log("      toasts:", JSON.stringify(await page.locator("[popover] [role]").allInnerTexts()));
    await page.getByText("Imported 1 line").waitFor({ timeout: 3000 });
    let s = await state();
    const ah = s.txs.find((t) => /Albert Heijn/.test(t.description));
    assert(ah && ah.amount === -15 && ah.booked_on === "2026-09-26" && ah.account === "123456789", `abn parsed ${JSON.stringify(ah)}`);
    await page.getByRole("status").filter({ hasText: "Imported 1 line" }).getByRole("button", { name: "Undo" }).click();
    await waitFor(async () => (await state()).txs.length === 7, 5000, "undo removed line");
  });

  await step("to approve: confirm NS ↔ Trenitalia, dismiss Google", async () => {
    await page.getByRole("tab", { name: /To approve/ }).click();
    await shot(page, "03-to-check");
    const nsRow = page.locator("li", { hasText: "NS Groep" });
    await nsRow.getByText("Trenitalia").waitFor();
    await nsRow.getByRole("button", { name: "Match" }).click();
    await waitFor(async () => (await state()).txs.find((t) => t.counterparty.startsWith("NS"))?.matched_by === "manual", 5000, "manual match");
    const gRow = page.locator("li", { hasText: "GOOGLE" });
    await gRow.getByRole("button", { name: "Not this one" }).click();
    await page.getByRole("tab", { name: /Missing receipt\s*4/ }).waitFor();
  });

  await step("missing: no receipt needed for bank fee", async () => {
    await page.getByRole("tab", { name: /Missing receipt/ }).click();
    const row = page.locator("li", { hasText: "Kosten OranjePakket" });
    await row.getByRole("button", { name: "No receipt needed" }).click();
    await waitFor(async () => (await state()).txs.find((t) => t.counterparty.startsWith("Kosten"))?.status === "no_receipt", 5000, "no receipt");
    await page.getByRole("tab", { name: /No receipt needed\s*1/ }).waitFor();
    await page.getByRole("button", { name: "Always for Kosten OranjePakket" }).click();
    await waitFor(async () => (await state()).rules.some((r) => r.pattern === "Kosten OranjePakket" && r.exact), 5000, "rule saved");
    await page.getByRole("tab", { name: /No receipt needed/ }).click();
    await page.getByRole("button", { name: "Remove rule Kosten OranjePakket" }).waitFor();
    await shot(page, "03b-rules");
    await page.getByRole("tab", { name: /Missing receipt/ }).click();
  });

  await step("missing: link Google line to receipt via picker", async () => {
    const row = page.locator("li", { hasText: "GOOGLE" });
    await row.getByRole("button", { name: "Add receipt" }).click();
    const dlg = page.getByRole("dialog", { name: "Add receipt" });
    await dlg.waitFor();
    await shot(page, "04-attach");
    await dlg.getByRole("button", { name: /Google Cloud/ }).click();
    await waitFor(async () => {
      const s = await state();
      const t = s.txs.find((x) => x.counterparty === "GOOGLE *WORKSPACE");
      return t?.status === "matched" && s.docs.find((d) => d.id === t.document_id)?.vendor === "Google Cloud";
    }, 5000, "picked");
  });

  await step("missing: upload a receipt straight from the hotel line", async () => {
    const row = page.locator("li", { hasText: "Hotel Adlon" });
    await row.getByRole("button", { name: "Add receipt" }).click();
    const dlg = page.getByRole("dialog", { name: "Add receipt" });
    await dlg.locator("input[type=file]").setInputFiles(path.join(FIX, "page2.jpg"));
    await waitFor(async () => {
      const s = await state();
      const t = s.txs.find((x) => x.counterparty === "Hotel Adlon Berlin");
      return t?.status === "matched" && s.docs.some((d) => d.id === t.document_id);
    }, 15000, "uploaded + linked");
    await waitFor(async () => (await state()).docs.every((d) => d.status === "ready"), 15000, "read");
  });

  await step("unlink sticks (suggestion does not come back)", async () => {
    await page.getByRole("tab", { name: /Matched/ }).click();
    const row = page.locator("li", { hasText: "Bar Centrale Amsterdam" });
    await row.getByRole("button", { name: "Unlink" }).click();
    await page.waitForTimeout(1500);
    const t = (await state()).txs.find((x) => x.counterparty === "Bar Centrale Amsterdam");
    assert(t.status === "unmatched" && !t.document_id, `still unlinked: ${t.status}`);
    await page.getByRole("tab", { name: /To approve/ }).click();
    assert((await page.locator("li", { hasText: "Bar Centrale Amsterdam" }).count()) === 0, "not suggested again");
    // relink it for the rest of the run
    await page.getByRole("tab", { name: /Missing receipt/ }).click();
    await page.locator("li", { hasText: "Bar Centrale Amsterdam" }).getByRole("button", { name: "Add receipt" }).click();
    await page.getByRole("dialog", { name: "Add receipt" }).getByRole("button", { name: /Bar Centrale/ }).click();
    await waitFor(async () => (await state()).txs.find((x) => x.counterparty === "Bar Centrale Amsterdam").status === "matched", 5000, "relinked");
  });

  await step("receipts not in bank lists ACME", async () => {
    await page.getByRole("tab", { name: /Receipts not in bank/ }).click();
    await page.getByRole("button", { name: /ACME Cloud/ }).waitFor();
    await shot(page, "05-not-in-bank");
  });

  await step("export missing receipts list", async () => {
    await page.getByRole("tab", { name: /Missing receipt/ }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export/ }).click()]);
    console.log("      name:", dl.suggestedFilename());
    assert(/^Missing receipts - All time - \d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), "ascii file name");
    const file = path.join(DL, dl.suggestedFilename());
    await dl.saveAs(file);
    const py = PY;
    const out = execSync(`${py} -c "import openpyxl; ws=openpyxl.load_workbook('${file}').active; [print(r) for r in ws.iter_rows(values_only=True)]"`).toString();
    console.log(out.trim().split("\n").map((l) => "      " + l).join("\n"));
    assert(/Client Studio BV/.test(out) && /2500/.test(out), "export rows");
  });

  await step("matched doc opens with payment line and booked toggle", async () => {
    await page.getByRole("tab", { name: /Matched/ }).click();
    await page.locator("li", { hasText: "AMAZON EU SARL" }).getByRole("button", { name: /Amazon/ }).click();
    const panel = page.getByRole("dialog", { name: "Document" });
    await panel.getByText(/Paid 3 Sep 2026 · €129\.00/).waitFor();
    await panel.getByLabel("Booked in accounting").check();
    await waitFor(async () => Boolean((await state()).docs.find((d) => d.vendor === "Amazon").booked_at), 5000, "booked");
    await shot(page, "06-panel-paid");
    await panel.getByLabel("Close").click();
  });

  await step("documents: status filters", async () => {
    await page.getByRole("link", { name: "Documents" }).click();
    await page.waitForURL(APP + "/");
    await page.getByLabel("Status").selectOption("unpaid");
    await page.getByText("1 document", { exact: true }).waitFor(); // ACME
    await page.getByLabel("Status").selectOption("booked");
    await page.getByText("1 document", { exact: true }).waitFor(); // Amazon
    await page.getByLabel("Status").selectOption("unbooked");
    await page.getByText("5 documents").waitFor();
    await shot(page, "07-docs-unbooked");
  });

  await step("download unbooked → mark booked from the prompt", async () => {
    await page.getByLabel("Select all").check();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download 5" }).click()]);
    await dl.saveAs(path.join(DL, dl.suggestedFilename()));
    await page.getByText("Mark 5 as booked in accounting?").waitFor();
    await page.getByRole("button", { name: "Mark booked" }).first().click();
    await waitFor(async () => (await state()).docs.every((d) => d.booked_at), 5000, "all booked");
    await page.getByText("Nothing matches.").waitFor();
    await shot(page, "08-all-booked");
  });

  await step("bulk mark not booked", async () => {
    await page.getByLabel("Status").selectOption("booked");
    await page.getByLabel("Select all").check();
    await page.getByRole("button", { name: "Mark not booked" }).click();
    await waitFor(async () => (await state()).docs.every((d) => !d.booked_at), 5000, "all unbooked");
  });

  await step("phone: bank page fits", async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: await ctx.storageState() });
    const m = await phone.newPage();
    await m.goto(APP + "/bank");
    await m.getByRole("tab", { name: /Missing receipt/ }).waitFor();
    await shot(m, "09-bank-phone");
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 0, `overflow ${overflow}`);
    await m.goto(APP + "/");
    await m.getByText(/documents/).first().waitFor();
    await shot(m, "10-docs-phone");
    await phone.close();
  });

  await step("ING Belgium CSV: rules mark fees, payroll, salary, rent, car loan", async () => {
    await page.goto(APP + "/bank");
    await page.waitForLoadState("networkidle"); // hydrated, so the file input is wired up
    await page.locator("input[type=file]").first().setInputFiles(path.join(FIX, "ing-be-sample.csv"));
    await page.getByText(/Imported 97 lines · \d+ need no receipt/).waitFor();
    const s = await state();
    const be = s.txs.filter((t) => t.account === "BE00000000000001");
    const covered = be.filter((t) => t.status === "no_receipt");
    console.log("      marked:", Object.entries(covered.reduce((m, t) => ((m[t.note] = (m[t.note] ?? 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(", "));
    const is = (pred, note, label) => {
      const lines = be.filter(pred);
      assert(lines.length && lines.every((t) => t.status === "no_receipt" && t.note === note), `${label}: ${lines.map((t) => t.status + "/" + t.note).join(",")}`);
    };
    is((t) => t.counterparty === "ING", "Bank fees", "ING fees");
    is((t) => /SD Worx/.test(t.counterparty ?? ""), "Peppol", "SD Worx");
    is((t) => /Salary payment/.test(t.description ?? ""), "Salary", "salary");
    is((t) => /Radius/.test(t.counterparty ?? ""), "Peppol", "Radius");
    is((t) => /Jane Peeters/.test(t.counterparty ?? ""), "Rent", "rent");
    is((t) => /^Reimbursement Car loan/.test(t.description ?? ""), "Car loan", "car loan");
    const card = be.filter((t) => /MASTERCARD/.test(t.description ?? ""));
    assert(card.length === 3 && card.every((t) => t.status === "unmatched"), "card settlements still open");
    assert(be.find((t) => t.counterparty === "ING Belgique S.A.").status === "unmatched", "ING Belgique transfer not a fee");
    await page.getByRole("tab", { name: /No receipt needed/ }).click();
    await shot(page, "11-ing-be-rules");
  });

  await step("ING Belgium: re-import skips every line (entry-number fingerprints)", async () => {
    const s = await state();
    const be = s.txs.filter((t) => t.account === "BE00000000000001");
    assert(be.length === 97 && be.every((t) => /^\d+$/.test(t.bank_ref ?? "")), "entry numbers stored");
    await page.locator("input[type=file]").first().setInputFiles(path.join(FIX, "ing-be-sample.csv"));
    await page.getByText("Nothing new · 97 already here").waitFor();
  });

  await step("ING Belgium: lines stored with old fingerprints are not duplicated", async () => {
    const map = JSON.parse(fs.readFileSync(path.join(FIX, "ing-be-sample-map.json"), "utf8"));
    const oldFor = new Map(map.map(([legacy, fresh]) => [fresh, legacy]));
    const s = await state();
    const changes = s.txs.filter((t) => oldFor.has(t.fingerprint)).map((t) => ({ id: t.id, fingerprint: oldFor.get(t.fingerprint), bank_ref: null }));
    assert(changes.length === 97, `simulated ${changes.length}`);
    await fetch(`${MOCK}/__set`, { method: "POST", body: JSON.stringify(changes) });
    await page.locator("input[type=file]").first().setInputFiles(path.join(FIX, "ing-be-sample.csv"));
    await page.getByText("Nothing new · 97 already here").waitFor();
    assert((await state()).txs.filter((t) => t.account === "BE00000000000001").length === 97, "still 97");
  });

  await step("bank: drop a receipt on the page → stored and read", async () => {
    await page.getByRole("tab", { name: /Missing receipt/ }).click();
    const before = (await state()).docs.length;
    await dropFile(page, path.join(FIX, "drop-receipt.jpg"), "image/jpeg");
    await page.getByText("Unknown Shop: no matching payment yet · kept in Documents").waitFor({ timeout: 15000 });
    await waitFor(async () => {
      const s = await state();
      return s.docs.length === before + 1 && s.docs.every((d) => d.status === "ready");
    }, 15000, "receipt stored and read");
    assert(!(await page.evaluate(() => document.body.innerText.includes("Drop a statement"))), "overlay gone");
  });

  await step("bank: drop a matching receipt anywhere → offered → approve", async () => {
    await dropFile(page, path.join(FIX, "vlabel.jpg"), "image/jpeg");
    const offer = page.getByRole("status").filter({ hasText: "Vlabel €168.66 → bank payment Vlabel, 29 Sep 2026" });
    await offer.waitFor({ timeout: 15000 });
    await page.waitForTimeout(300);
    assert((await state()).txs.find((t) => t.counterparty === "Vlabel").status === "unmatched", "not linked before approval");
    await shot(page, "11a-offer");
    await offer.getByRole("button", { name: "Approve" }).click();
    await waitFor(async () => {
      const s = await state();
      const t = s.txs.find((x) => x.counterparty === "Vlabel");
      return t.status === "matched" && s.docs.find((d) => d.id === t.document_id)?.vendor === "Vlabel";
    }, 5000, "approved");
  });

  await step("bank: drop a receipt onto a line → attached to that payment", async () => {
    const row = page.locator("li", { hasText: "SPOORLOOS PERRON", has: page.getByRole("button", { name: "Add receipt" }) }).first();
    await dropFile(page, path.join(FIX, "row-receipt.jpg"), "image/jpeg", row);
    assert(await page.evaluate(() => window.__highlight), "line highlighted while dragging over it");
    await waitFor(async () => {
      const s = await state();
      const t = s.txs.find((x) => x.counterparty === "SPOORLOOS PERRON");
      return t.status === "matched" && t.matched_by === "manual" && s.docs.find((d) => d.id === t.document_id)?.file_name === "row-receipt.jpg";
    }, 15000, "receipt linked to the line");
    await page.waitForTimeout(300);
    assert(!(await page.evaluate(() => document.body.innerText.includes("Drop a statement"))), "overlay gone after a line drop");
    const docs = (await state()).docs.filter((d) => d.file_name === "row-receipt.jpg");
    assert(docs.length === 1, "stored once, not also by the page drop");
  });

  await step("billing page: add for SUPABASE, open, edit, remove", async () => {
    await page.getByRole("tab", { name: /Missing receipt/ }).click();
    const row = page.locator("li", { hasText: "SUPABASE", has: page.getByRole("button", { name: "Add receipt" }) }).first();
    await row.getByRole("button", { name: "Add billing page" }).click();
    const dlg = page.getByRole("dialog", { name: "Billing page" });
    assert((await dlg.getByLabel("For lines containing").inputValue()) === "SUPABASE", "pattern prefilled");
    await dlg.getByLabel("Link").fill("not a link");
    await dlg.getByRole("button", { name: "Save" }).click();
    await dlg.getByText("That doesn't look like a link.").waitFor();
    await dlg.getByLabel("Link").fill("supabase.com/dashboard/org/_/billing");
    await dlg.getByRole("button", { name: "Save" }).click();
    await dlg.waitFor({ state: "hidden" });
    const s = await state();
    assert(s.vendorLinks.length === 1 && s.vendorLinks[0].url === "https://supabase.com/dashboard/org/_/billing", "link saved");
    const links = page.locator('a[href="https://supabase.com/dashboard/org/_/billing"]');
    assert((await links.count()) === 4, `3 rows + 1 chip, got ${await links.count()}`);
    const chip = page.getByRole("link", { name: /SUPABASE\s*×3/ });
    await chip.waitFor();
    assert((await chip.getAttribute("target")) === "_blank", "opens new tab");
    await shot(page, "11b-billing");
    await row.getByRole("button", { name: "Edit billing page" }).click();
    await dlg.getByRole("button", { name: "Remove" }).click();
    await dlg.waitFor({ state: "hidden" });
    assert((await state()).vendorLinks.length === 0, "removed");
    // Keep one for the rest of the run.
    await row.getByRole("button", { name: "Add billing page" }).click();
    await dlg.getByLabel("Link").fill("https://supabase.com/dashboard/org/_/billing");
    await dlg.getByRole("button", { name: "Save" }).click();
    await dlg.waitFor({ state: "hidden" });
  });

  await step("card: drop statement PDF → recognised, lines, fee covered by rule", async () => {
    await page.getByRole("link", { name: "Card" }).click();
    await page.waitForURL(APP + "/card");
    await page.getByText("Add a credit card statement").waitFor();
    await shot(page, "12-card-empty");
    await dropFile(page, path.join(FIX, "card-statement.pdf"), "application/pdf"); // recognised as a statement
    await page.getByText("5 card lines · 1 need no receipt").waitFor({ timeout: 15000 });
    const s = await state();
    const stmt = s.docs.find((d) => d.doc_type === "statement");
    assert(stmt && stmt.total === 236.02 && stmt.vendor === "ING" && stmt.doc_date === "2026-09-01" && stmt.status === "ready", `statement doc ${JSON.stringify(stmt)}`);
    assert(Math.abs(stmt.ai_cost_usd - 0.0033 - 0.02) < 0.001, `both reads counted: ${stmt.ai_cost_usd}`);
    const lines = s.txs.filter((t) => t.source === "card");
    assert(lines.length === 5 && lines.every((t) => t.statement_id === stmt.id && t.account === "•••• 3533"), "card lines saved");
    assert(lines.find((t) => t.counterparty === "Coolblue").amount === 20, "refund positive");
    assert(lines.find((t) => t.counterparty === "Shell Mechelen").amount === -65, "purchase negative");
    assert(lines.find((t) => t.counterparty === "ING").status === "no_receipt", "card fee covered");
    const tabs = await page.getByRole("tablist").innerText();
    console.log("      tabs:", tabs.replace(/\n/g, " "));
    assert(/Missing receipt\s*3/.test(tabs) && /To approve\s*1/.test(tabs) && /Statements\s*1/.test(tabs), "card tabs");
    await shot(page, "13-card-missing");
  });

  await step("card: adding the same statement again reads it again without duplicates", async () => {
    await page.locator("input[type=file]").first().setInputFiles(path.join(FIX, "card-statement.pdf"));
    await page.getByText("5 card lines · 1 need no receipt").waitFor({ timeout: 15000 });
    const s = await state();
    assert(s.txs.filter((t) => t.source === "card").length === 5 && s.docs.filter((d) => d.doc_type === "statement").length === 1, "no duplicates");
  });

  await step("card: approve ACME invoice for its card line", async () => {
    await page.getByRole("tab", { name: /To approve/ }).click();
    await page.getByRole("button", { name: "Approve 1" }).click();
    await waitFor(async () => {
      const s = await state();
      const t = s.txs.find((x) => x.source === "card" && x.counterparty === "ACME Cloud");
      return t.status === "matched" && s.docs.find((d) => d.id === t.document_id)?.vendor === "ACME Cloud";
    }, 5000, "acme approved");
  });

  await step("bank: statement matches the Mastercard settlement", async () => {
    await page.getByRole("link", { name: /Bank/ }).click();
    await page.waitForURL(APP + "/bank");
    await page.getByRole("tab", { name: /To approve/ }).click();
    const row = page.locator("li", { hasText: "MASTERCARD" }).filter({ hasText: "236" });
    await row.getByRole("button", { name: "Match" }).waitFor();
    await shot(page, "14-bank-statement-match");
    await row.getByRole("button", { name: "Match" }).click();
    await waitFor(async () => {
      const s = await state();
      const stmt = s.docs.find((d) => d.doc_type === "statement");
      return s.txs.some((t) => t.source === "bank" && t.document_id === stmt.id && t.amount === -236.02);
    }, 5000, "statement linked to bank line");
    await page.getByRole("link", { name: /Card/ }).click();
    await page.waitForURL(APP + "/card");
    await page.getByRole("tab", { name: /Statements/ }).click();
    await page.getByText(/5 lines · 3 without receipt · paid 16 Sep 2026/).waitFor();
    await shot(page, "15-statements");
  });

  await step("documents: new receipt → offered its card payment → approve", async () => {
    await page.getByRole("link", { name: /Doc/ }).click();
    await page.waitForURL(APP + "/");
    await page.locator("input[type=file][multiple]").first().setInputFiles(path.join(FIX, "shell.jpg"));
    const offer = page.getByRole("status").filter({ hasText: "Shell €65.00 → card payment Shell Mechelen, 12 Aug 2026" });
    await offer.waitFor({ timeout: 15000 });
    assert(/1/.test(await page.getByRole("link", { name: /Card/ }).innerText()), "card badge");
    await shot(page, "16-match-toast");
    await offer.getByRole("button", { name: "Approve" }).click();
    await waitFor(async () => (await state()).txs.find((t) => t.counterparty === "Shell Mechelen").status === "matched", 5000, "shell approved");
    await page.waitForTimeout(300);
    assert(!/\d/.test(await page.getByRole("link", { name: /Card/ }).innerText()), "badge cleared");
  });

  await step("statement is left out of document totals", async () => {
    await page.getByRole("link", { name: /Doc/ }).click();
    await page.waitForURL(APP + "/");
    await page.getByText(/documents/).first().waitFor();
    const s = await state();
    const expected = s.docs.filter((d) => d.doc_type !== "statement" && d.currency === "EUR").reduce((a, d) => a + d.total, 0);
    const body = await page.locator("main").innerText();
    const shown = expected.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    assert(body.includes(shown), `total ${shown} shown in: ${body.slice(0, 200)}`);
  });

  await step("download by month: card statement in its month, named as such, can be left out", async () => {
    const september = (await state()).docs.filter((d) => d.doc_date.startsWith("2026-09"));
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const dlg = page.getByRole("dialog", { name: "Download" });
    await pickMonths(dlg, ["2026-09"]);
    await dlg.getByText(`${september.length} documents · a folder per month`).waitFor();
    const toggle = dlg.getByLabel("Card statements");
    assert(await toggle.isChecked(), "statements included by default");
    await toggle.uncheck();
    await dlg.getByText(`${september.length - 1} documents · a folder per month`).waitFor();
    await toggle.check();
    await shot(page, "16b-download-september");
    const [dl] = await Promise.all([page.waitForEvent("download"), dlg.getByRole("button", { name: "Download", exact: true }).click()]);
    const file = path.join(DL, dl.suggestedFilename());
    await dl.saveAs(file);
    const names = execSync(`unzip -Z1 "${file}"`).toString().trim().split("\n");
    console.log(`      ${dl.suggestedFilename()}:\n` + names.map((n) => "        " + n).join("\n"));
    assert(dl.suggestedFilename() === "Documents - September 2026.zip", "named after the month");
    assert(names.includes("2026-09 September/2026-09-01 ING card statement 236.02 EUR.pdf"), "statement named as such");
    assert(names.length === september.length + 1, "every September document plus the summary");
    assert(names.slice(1).every((n) => n.startsWith("2026-09 September/") && n.endsWith(".pdf")), "all in the month folder, all PDFs");
  });

  await step("a policy covering several payments: link once, then every instalment is offered", async () => {
    await page.getByRole("link", { name: /Doc/ }).click();
    await page.waitForURL(APP + "/");
    await page.waitForLoadState("networkidle");
    await page.locator("input[type=file][multiple]").first().setInputFiles(path.join(FIX, "lrs-policy.pdf"));
    await waitFor(async () => (await state()).docs.some((d) => d.vendor === "LRS Insurance" && d.status === "ready"), 15000, "policy read");
    await page.getByRole("button", { name: /LRS Insurance/ }).first().click();
    const panel = page.getByRole("dialog", { name: "Document" });
    await panel.waitFor();
    await page.waitForTimeout(800); // the preview loads and moves the switches down
    await panel.getByLabel("Covers several payments").check();
    await waitFor(async () => (await state()).docs.find((d) => d.vendor === "LRS Insurance").recurring === true, 5000, "switch saved");
    await panel.getByLabel("Close").click();

    await page.getByRole("link", { name: /Bank/ }).click();
    await page.waitForURL(APP + "/bank");
    await page.waitForLoadState("networkidle");
    await page.locator("input[type=file]").first().setInputFiles(path.join(FIX, "lrs.csv"));
    await page.getByText("Imported 2 lines").waitFor();
    let s = await state();
    const lrs = s.txs.filter((t) => /Polis 1082394/.test(t.description));
    assert(lrs.length === 2 && lrs.every((t) => t.status === "unmatched"), `both instalments open: ${JSON.stringify(s.txs.filter((t) => /LRS/i.test(t.counterparty + t.description)).map((t) => [t.counterparty, t.status, t.booked_on]))}`);

    // The annual total isn't an instalment: link the first payment by hand.
    await page.getByRole("tab", { name: /Missing receipt/ }).click();
    await page.locator("li", { hasText: "Polis 1082394 kwartaal 3" }).getByRole("button", { name: "Add receipt" }).click();
    const picker = page.getByRole("dialog", { name: "Add receipt" });
    await picker.getByRole("button", { name: /LRS Insurance/ }).click();
    await waitFor(async () => (await state()).txs.filter((t) => /Polis 1082394/.test(t.description) && t.status === "matched").length === 1, 5000, "first linked");

    // The other quarter is now offered with the same policy.
    await page.getByRole("tab", { name: /To approve/ }).click();
    const offer = page.locator("li", { hasText: "Polis 1082394 kwartaal 4" });
    await offer.getByText("LRS Insurance", { exact: true }).first().waitFor();
    await offer.getByRole("button", { name: "Match" }).first().click();
    await waitFor(async () => (await state()).txs.filter((t) => /Polis 1082394/.test(t.description) && t.status === "matched").length === 2, 5000, "second linked");
    s = await state();
    const policy = s.docs.find((d) => d.vendor === "LRS Insurance");
    assert(s.txs.filter((t) => /Polis 1082394/.test(t.description)).every((t) => t.document_id === policy.id), "both payments point to the policy");

    await page.getByRole("link", { name: /Doc/ }).click();
    await page.waitForURL(APP + "/");
    await page.getByRole("button", { name: /LRS Insurance/ }).first().click();
    await panel.getByText(/Paid 2 times · last 3 Oct 2026/).waitFor();
    await shot(page, "16c-policy-two-payments");
    await panel.getByLabel("Close").click();
  });

  await step("deleting a document frees its payment", async () => {
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /LRS Insurance/ }).first().click();
    await page.getByRole("dialog", { name: "Document" }).getByRole("button", { name: "Delete" }).click();
    await page.getByText("Deleted").first().waitFor();
    const lines = (await state()).txs.filter((t) => /Polis 1082394/.test(t.description));
    assert(lines.every((t) => t.status === "unmatched" && !t.document_id), "lines back to unmatched");
  });

  await step("phone: card page and 3-tab header fit", async () => {
    const phone = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: await ctx.storageState() });
    const m = await phone.newPage();
    for (const url of ["/card", "/bank", "/"]) {
      await m.goto(APP + url);
      await m.waitForTimeout(800);
      const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 0, `${url} overflow ${overflow}`);
      const acct = await m.getByRole("button", { name: "Account" }).boundingBox();
      assert(acct && acct.x + acct.width <= 360, `${url} account button visible`);
    }
    await m.goto(APP + "/card");
    await m.getByRole("tab", { name: /Missing receipt/ }).waitFor();
    await shot(m, "17-card-phone");
    await phone.close();
  });

  console.log("\nconsole errors:", consoleErrors.length ? "\n  " + consoleErrors.join("\n  ") : "none");
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})();
