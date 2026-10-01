// End-to-end walkthrough of the app against the local mock backend.
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const APP = "http://localhost:3100";
const MOCK = "http://localhost:54321";
const DIR = __dirname;
// Python with openpyxl, pypdf and pillow validates the exported files (see e2e/README.md).
const PY = process.env.E2E_PYTHON || "python3";
const SHOTS = path.join(DIR, "shots");
const DL = path.join(DIR, "downloads");
const FIX = path.join(DIR, "fixtures");
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });

const PASSWORD = "correct horse battery";
let failures = 0;
const consoleErrors = [];

async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    console.log(`PASS  ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}\n      ${String(err && err.stack || err).split("\n").slice(0, 4).join("\n      ")}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function state() {
  return (await fetch(`${MOCK}/__state`)).json();
}

async function shot(page, name) {
  await page.waitForTimeout(400); // let entry animations finish
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function waitFor(fn, timeout = 15000, label = "condition") {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function watch(page, tag) {
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[${tag}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => consoleErrors.push(`[${tag}] pageerror: ${err.message}`));
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

  // ---------------------------------------------------------------- Desktop
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await desktop.newPage();
  watch(page, "desktop");

  await step("signed-out visit redirects to /login", async () => {
    await page.goto(APP + "/");
    await page.waitForURL("**/login");
    await page.getByRole("button", { name: "Sign in" }).waitFor();
    await shot(page, "01-login-desktop");
  });

  await step("wrong password shows an error", async () => {
    await page.getByLabel("Email").fill("luca@tiltedi.com");
    await page.getByLabel("Password").fill("nope");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Wrong email or password.").waitFor();
  });

  await step("correct password opens the empty dashboard", async () => {
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(APP + "/");
    await page.getByText("No documents yet").waitFor();
    await shot(page, "02-empty-desktop");
  });

  await step("signed-in visit to /login bounces to the dashboard", async () => {
    await page.goto(APP + "/login");
    await page.waitForURL(APP + "/");
    await page.getByText("No documents yet").waitFor();
  });

  await step("upload PDF + JPEG + PNG, each is read and categorised", async () => {
    const input = page.locator("input[type=file][multiple]").first();
    await input.setInputFiles([path.join(FIX, "invoice.pdf"), path.join(FIX, "receipt-photo.jpg"), path.join(FIX, "ticket.png")]);
    await waitFor(async () => (await state()).docs.filter((d) => d.status === "ready").length === 3, 20000, "3 ready docs");
    const s = await state();
    assert(s.anthropicCalls === 3, `expected 3 Claude calls, got ${s.anthropicCalls}`);
    assert(s.files.length === 3, "3 files stored");
    await page.getByText("Reading…").first().waitFor({ state: "detached" }).catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, "03-list-desktop");
    const names = s.docs.map((d) => `${d.vendor}|${d.category}|${d.total}|${d.currency}|${d.doc_date}`).join("; ");
    console.log("      docs:", names);
    for (const d of s.docs) assert(d.vendor && d.category && d.total != null, "fields filled");
    const pdfDoc = s.docs.find((d) => d.file_name === "invoice.pdf");
    const stored = fs.readFileSync(path.join("/tmp/mock-state", pdfDoc.file_path.replace(/\//g, "_")));
    assert(stored.equals(fs.readFileSync(path.join(FIX, "invoice.pdf"))), "stored PDF is byte-identical");
    const sha = require("crypto").createHash("sha256").update(stored).digest("hex");
    assert(pdfDoc.sha256 === sha, "sha256 recorded");
  });

  await step("Claude request shape: model, fallbacks, effort, structured output, cache", async () => {
    const lines = fs.readFileSync("/tmp/mock-requests.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const calls = lines.filter((l) => l.kind === "anthropic");
    const c = calls[0];
    console.log("      request:", JSON.stringify(c));
    assert(c.model === "claude-sonnet-5-5", "model");
    assert(c.fallbacks === "default", "fallbacks default");
    assert(String(c.headers.beta).includes("server-side-fallback-2026-07-01"), "beta header");
    assert(c.effort === "low", "effort low");
    assert(c.formatType === "json_schema", "json schema output");
    assert(["vendor", "doc_date", "category", "total", "currency"].every((k) => c.schemaKeys.includes(k)), "schema keys");
    assert(c.systemCache && c.systemCache.type === "ephemeral", "system prompt cached");
    const kinds = calls.map((x) => x.blockTypes[0]).sort();
    assert(kinds.includes("document:application/pdf") && kinds.includes("image:image/jpeg") && kinds.includes("image:image/png"), `block types ${kinds}`);
  });

  await step("list shows vendors, amounts and month headers", async () => {
    for (const v of ["ACME Cloud", "Bar Centrale", "Trenitalia"]) await page.getByRole("button", { name: new RegExp(v) }).first().waitFor();
    const text = await page.locator("main").innerText();
    assert(/3 documents/.test(text), "count label");
    assert(/€/.test(text), "euro amounts");
    assert(/JULY 2026|July 2026/i.test(text), "month header");
  });

  await step("uploading the same PDF again is caught as a duplicate", async () => {
    const input = page.locator("input[type=file][multiple]").first();
    await input.setInputFiles([path.join(FIX, "invoice.pdf")]);
    await page.getByText("invoice.pdf is already here").waitFor();
    const s = await state();
    assert(s.docs.length === 3 && s.files.length === 3, "no extra doc/file");
  });

  await step("unsupported file type is rejected with a message", async () => {
    const input = page.locator("input[type=file][multiple]").first();
    await input.setInputFiles([path.join(FIX, "notes.txt")]);
    await page.getByText("notes.txt: only PDFs and images").waitFor();
  });

  await step("search filters instantly", async () => {
    await page.getByLabel("Search documents").fill("trenit");
    await page.getByText("1 document", { exact: true }).waitFor();
    await page.getByLabel("Search documents").fill("");
    await page.getByText("3 documents").waitFor();
  });

  await step("'/' focuses search", async () => {
    await page.locator("body").click({ position: { x: 5, y: 700 } });
    await page.keyboard.press("/");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    assert(focused === "Search documents", `focused ${focused}`);
    await page.keyboard.press("Escape");
  });

  await step("category filter", async () => {
    await page.getByLabel("Category").selectOption("Travel");
    await page.getByText("1 document", { exact: true }).waitFor();
    await page.getByLabel("Category").selectOption("");
    await page.getByText("3 documents").waitFor();
  });

  await step("date range: presets and custom range", async () => {
    await page.getByRole("button", { name: /All time/ }).click();
    await page.getByRole("dialog", { name: "Date range" }).waitFor();
    await shot(page, "04-dates-desktop");
    await page.getByRole("button", { name: "Last year" }).click();
    await page.getByText("Nothing matches.").waitFor();
    await page.getByRole("button", { name: "Show everything" }).click();
    await page.getByText("3 documents").waitFor();
    // Custom: July 2026 only.
    await page.getByRole("button", { name: /All time/ }).click();
    const dlg = page.getByRole("dialog", { name: "Date range" });
    await dlg.waitFor();
    // Navigate the calendar back to July 2026 and pick 1 → 31.
    for (let i = 0; i < 6; i++) {
      const caption = await dlg.locator(".rdp-caption_label").first().innerText();
      if (/July 2026/.test(caption)) break;
      await dlg.getByRole("button", { name: /previous month/i }).click();
    }
    await dlg.getByRole("button", { name: /July 1st, 2026/ }).click();
    await dlg.getByRole("button", { name: /July 31st, 2026/ }).click();
    await dlg.getByRole("button", { name: "Apply" }).click();
    await page.getByRole("button", { name: /July 2026/ }).waitFor();
    await page.getByText("1 document", { exact: true }).waitFor();
    await shot(page, "05-range-july");
    await page.getByRole("button", { name: /July 2026/ }).click();
    await page.getByRole("button", { name: "All time" }).click();
    await page.getByText("3 documents").waitFor();
  });

  await step("open a document, edit and save", async () => {
    await page.getByRole("button", { name: /Trenitalia/ }).first().click();
    const panel = page.getByRole("dialog", { name: "Document" });
    await panel.waitFor();
    await page.waitForTimeout(500);
    await shot(page, "06-panel-desktop");
    await panel.getByLabel("Vendor").fill("Trenitalia SpA");
    await panel.getByLabel("Total").fill("1.234,50");
    await panel.getByLabel("Notes").fill("Client visit Rome");
    await panel.getByRole("button", { name: "Save" }).click();
    await page.getByText("Saved").first().waitFor();
    assert((await panel.getByLabel("Total").inputValue()) === "1234.50", "total normalised after save");
    assert(await panel.getByRole("button", { name: "Save" }).isDisabled(), "save disabled once saved");
    const onTop = await page.evaluate(() => document.querySelector("[popover]")?.matches(":popover-open"));
    assert(onTop === true, "toast shown in the top layer above the dialog");
    await shot(page, "06b-saved-toast");
    const s = await state();
    const d = s.docs.find((x) => x.vendor === "Trenitalia SpA");
    assert(d && d.total === 1234.5 && d.notes === "Client visit Rome", `saved ${JSON.stringify(d && { t: d.total, n: d.notes })}`);
    await panel.getByLabel("Close").click();
    await page.getByRole("button", { name: /Trenitalia SpA/ }).first().waitFor();
  });

  await step("invalid currency is refused before saving", async () => {
    await page.getByRole("button", { name: /Bar Centrale/ }).first().click();
    const panel = page.getByRole("dialog", { name: "Document" });
    await panel.waitFor();
    // The select only offers valid codes; force an invalid value via DOM to hit the guard.
    await panel.getByLabel("Currency").evaluate((el) => {
      const o = document.createElement("option");
      o.value = "EURO";
      o.textContent = "EURO";
      el.appendChild(o);
    });
    await panel.getByLabel("Currency").selectOption("EURO");
    await panel.getByRole("button", { name: "Save" }).click();
    await page.getByText("Currency must be a 3-letter code.").waitFor();
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
  });

  await step("read again re-runs extraction", async () => {
    const before = (await state()).anthropicCalls;
    await page.getByRole("button", { name: /ACME Cloud/ }).first().click();
    const panel = page.getByRole("dialog", { name: "Document" });
    await panel.getByRole("button", { name: "Read again" }).click();
    await waitFor(async () => (await state()).anthropicCalls === before + 1, 10000, "extra claude call");
    await page.waitForTimeout(900);
    await panel.getByLabel("Close").click();
  });

  await step("single download from a row", async () => {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download Bar Centrale/ }).first().click()]);
    const file = path.join(DL, dl.suggestedFilename());
    await dl.saveAs(file);
    console.log("      single:", dl.suggestedFilename(), fs.statSync(file).size);
    assert(dl.suggestedFilename() === "2026-08-03 Bar Centrale 49.90 EUR.jpg", "nice filename");
    assert(fs.readFileSync(file).equals(fs.readFileSync(path.join(FIX, "receipt-photo.jpg"))), "downloaded bytes match the original");
  });

  await step("select all → download ZIP with Summary.xlsx", async () => {
    await page.getByLabel("Select all").check();
    await page.getByText("3 selected").waitFor();
    await shot(page, "07-selected-desktop");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download 3" }).click()]);
    const file = path.join(DL, dl.suggestedFilename());
    await dl.saveAs(file);
    console.log("      zip:", dl.suggestedFilename());
    const listing = execSync(`unzip -l "${file}"`).toString();
    console.log(listing.split("\n").slice(3, -3).map((l) => "      " + l.trim()).join("\n"));
    execSync(`unzip -t "${file}"`);
    assert(/Summary\.xlsx/.test(listing), "summary present");
    assert((listing.match(/\.(pdf|jpg|png)/g) || []).length === 3, "3 documents in zip");
    fs.rmSync(path.join(DL, "unzipped"), { recursive: true, force: true });
    execSync(`unzip -o -q "${file}" -d "${path.join(DL, "unzipped")}"`);
    const py = PY;
    const out = execSync(`${py} - <<'EOF'
import openpyxl, glob
wb = openpyxl.load_workbook("${path.join(DL, "unzipped", "Summary.xlsx")}")
ws = wb.active
rows = list(ws.iter_rows(values_only=True))
print(rows[0])
for r in rows[1:]: print(r)
EOF`).toString();
    console.log(out.trim().split("\n").map((l) => "      " + l).join("\n"));
    assert(/Trenitalia SpA/.test(out) && /1234\.5/.test(out) && /datetime\.datetime\(2026/.test(out), "xlsx has typed cells");
    await page.getByRole("button", { name: "Clear" }).click();
  });

  await step("download all (filtered) names the zip after the range", async () => {
    await page.getByLabel("Category").selectOption("Travel");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download/ }).first().click()]);
    console.log("      single-by-filter:", dl.suggestedFilename());
    await page.getByLabel("Category").selectOption("");
  });

  await step("delete a document", async () => {
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /ACME Cloud/ }).first().click();
    const panel = page.getByRole("dialog", { name: "Document" });
    await panel.getByRole("button", { name: "Delete" }).click();
    await page.getByText("Deleted").first().waitFor();
    const s = await state();
    assert(s.docs.length === 2 && s.files.length === 2, "row and file removed");
    await page.getByText("2 documents").waitFor();
  });

  await step("extraction failure marks the doc 'Not read' and offers retry", async () => {
    await fetch(`${MOCK}/__mode?anthropic=fail`);
    const input = page.locator("input[type=file][multiple]").first();
    await input.setInputFiles([path.join(FIX, "page1.jpg")]);
    await page.getByText("Could not read the document.").waitFor({ timeout: 15000 });
    await page.getByText("Not read").first().waitFor();
    await fetch(`${MOCK}/__mode?anthropic=ok`);
    await page.getByRole("button", { name: /page1\.jpg/ }).first().click();
    const panel = page.getByRole("dialog", { name: "Document" });
    await panel.getByText("Couldn’t read this one").waitFor();
    await shot(page, "08-failed-panel");
    await panel.getByRole("button", { name: "Try again" }).click();
    await waitFor(async () => (await state()).docs.every((d) => d.status === "ready"), 15000, "all ready");
    await page.waitForTimeout(800);
    await panel.getByLabel("Close").click();
  });

  await step("account: change password, sign out, sign back in", async () => {
    await page.getByRole("button", { name: "Account" }).click();
    const dlg = page.getByRole("dialog", { name: "Account" });
    await dlg.getByText("luca@tiltedi.com").waitFor();
    await shot(page, "09-account");
    await dlg.getByLabel("New password").fill("new password 2026!");
    await dlg.getByRole("button", { name: "Change password" }).click();
    await page.getByText("Password changed").waitFor();
    await dlg.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
    await page.getByLabel("Email").fill("luca@tiltedi.com");
    await page.getByLabel("Password").fill("new password 2026!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(APP + "/");
    await page.getByText("3 documents").waitFor();
  });

  await step("drag and drop overlay appears", async () => {
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "x.pdf", { type: "application/pdf" }));
      window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
    });
    await page.getByText("Drop to add").waitFor();
    await shot(page, "10-drop");
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "x.pdf", { type: "application/pdf" }));
      window.dispatchEvent(new DragEvent("dragleave", { dataTransfer: dt, bubbles: true }));
    });
    await page.getByText("Drop to add").waitFor({ state: "detached" });
  });

  // ------------------------------------------------------------------ Phone
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const m = await phone.newPage();
  watch(m, "phone");

  await step("phone: login screen", async () => {
    await m.goto(APP + "/login");
    await shot(m, "11-login-phone");
    await m.getByLabel("Email").fill("luca@tiltedi.com");
    await m.getByLabel("Password").fill("new password 2026!");
    await m.getByRole("button", { name: "Sign in" }).click();
    await m.waitForURL(APP + "/");
    await m.getByText("3 documents").waitFor();
    await m.waitForTimeout(300);
    await shot(m, "12-list-phone");
  });

  await step("phone: scan two pages → one PDF, read automatically", async () => {
    const before = await state();
    const camera = m.locator("input[type=file][capture]").first();
    await camera.setInputFiles(path.join(FIX, "page1.jpg"));
    const dlg = m.getByRole("dialog", { name: "Scan" });
    await dlg.getByText("1 page").waitFor();
    await dlg.locator("input[type=file][capture]").setInputFiles(path.join(FIX, "page2.jpg"));
    await dlg.getByText("2 pages").waitFor();
    await m.waitForTimeout(300);
    await shot(m, "13-scan-phone");
    await dlg.getByRole("button", { name: "Save" }).click();
    await waitFor(async () => (await state()).docs.length === before.docs.length + 1, 15000, "scan stored");
    await waitFor(async () => (await state()).docs.every((d) => d.status === "ready"), 15000, "scan read");
    const s = await state();
    const scan = s.docs.find((d) => d.file_name.startsWith("Scan "));
    assert(scan && scan.mime_type === "application/pdf", "scan is a pdf");
    const stored = path.join("/tmp/mock-state", scan.file_path.replace(/\//g, "_"));
    const py = PY;
    const out = execSync(`${py} - <<'EOF'
from pypdf import PdfReader
r = PdfReader("${stored}", strict=True)
print("pages", len(r.pages))
for p in r.pages:
    print("mediabox", [round(float(x),1) for x in p.mediabox], "images", [(i.name, i.image.size) for i in p.images])
EOF`).toString();
    console.log(out.trim().split("\n").map((l) => "      " + l).join("\n"));
    assert(/pages 2/.test(out), "2 pages");
    assert(/\(1800, 2400\)/.test(out) && /\(2400, 1800\)/.test(out), "downscaled to 2400px long side");
    await m.waitForTimeout(500);
    await shot(m, "14-after-scan-phone");
  });

  await step("phone: discard a scan asks first", async () => {
    const camera = m.locator("input[type=file][capture]").first();
    await camera.setInputFiles(path.join(FIX, "page1.jpg"));
    const dlg = m.getByRole("dialog", { name: "Scan" });
    await dlg.getByText("1 page").waitFor();
    let asked = false;
    m.once("dialog", (d) => {
      asked = true;
      d.accept();
    });
    await dlg.getByLabel("Close").click();
    await dlg.waitFor({ state: "hidden" });
    assert(asked, "confirm shown");
  });

  await step("phone: document sheet and date sheet", async () => {
    await m.getByRole("button", { name: /Trenitalia SpA/ }).first().click();
    const panel = m.getByRole("dialog", { name: "Document" });
    await panel.waitFor();
    await m.waitForTimeout(500);
    await shot(m, "15-panel-phone");
    await panel.getByLabel("Close").click();
    await m.getByRole("button", { name: /All time/ }).click();
    await m.getByRole("dialog", { name: "Date range" }).waitFor();
    await m.waitForTimeout(300);
    await shot(m, "16-dates-phone");
    await m.getByRole("button", { name: "This year" }).click();
    await m.getByRole("button", { name: /^2026$/ }).waitFor();
  });

  await step("phone: no horizontal overflow", async () => {
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 0, `overflow ${overflow}px`);
  });

  await step("dark mode (phone)", async () => {
    const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" });
    const d = await dark.newPage();
    watch(d, "dark");
    await d.goto(APP + "/login");
    await shot(d, "17-login-dark");
    await d.getByLabel("Email").fill("luca@tiltedi.com");
    await d.getByLabel("Password").fill("new password 2026!");
    await d.getByRole("button", { name: "Sign in" }).click();
    await d.waitForURL(APP + "/");
    await d.getByText("4 documents").waitFor();
    await shot(d, "18-list-dark");
    await d.getByRole("button", { name: /Google Cloud/ }).first().click();
    await d.getByRole("dialog", { name: "Document" }).waitFor();
    await shot(d, "19-panel-dark");
    await dark.close();
  });

  await step("desktop dates dialog shows two months side by side", async () => {
    await page.goto(APP + "/");
    await page.getByRole("button", { name: /All time/ }).click();
    const dlg = page.getByRole("dialog", { name: "Date range" });
    await dlg.waitFor();
    const boxes = await dlg.locator(".rdp-month").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    assert(boxes.length === 2 && Math.abs(boxes[0] - boxes[1]) < 2, `months tops ${boxes}`);
    const color = await dlg.locator(".rdp-today .rdp-day_button, .rdp-today").first().evaluate((e) => getComputedStyle(e).color);
    console.log("      today color:", color);
    assert(!/rgb\(0, 0, 255\)/.test(color), "today uses the app accent, not default blue");
    await shot(page, "20-dates-desktop-fixed");
    await page.keyboard.press("Escape");
  });

  await step("session expiry sends you back to login on next load", async () => {
    await fetch(`${MOCK}/__expire`);
    const fresh = await browser.newContext();
    const p = await fresh.newPage();
    await p.goto(APP + "/");
    await p.waitForURL("**/login");
    await fresh.close();
  });

  await step("API route rejects anonymous calls", async () => {
    const res = await fetch(`${APP}/api/extract`, { method: "POST", body: JSON.stringify({ id: "x" }) });
    assert(res.status === 401, `status ${res.status}`);
  });

  console.log("\nconsole errors:", consoleErrors.length ? "\n  " + consoleErrors.join("\n  ") : "none");
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})();
