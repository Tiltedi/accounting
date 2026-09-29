import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CATEGORIES, CATEGORY_NAMES, DOC_TYPE_VALUES } from "@/lib/categories";

// Reads a document with Claude and returns bookkeeping fields.

const MODEL = "claude-opus-5-5";

const ExtractionSchema = z.object({
  vendor: z
    .string()
    .nullable()
    .describe("Business that issued the document (supplier), or the customer for sales invoices"),
  description: z.string().nullable().describe("What was bought, at most 8 words"),
  doc_date: z.string().nullable().describe("Issue date as YYYY-MM-DD"),
  doc_type: z.enum(DOC_TYPE_VALUES),
  category: z.enum(CATEGORY_NAMES),
  invoice_number: z.string().nullable(),
  total: z.number().nullable().describe("Final amount including tax"),
  tax: z.number().nullable().describe("Total VAT / sales tax"),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. EUR"),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

const categoryList = CATEGORIES.map((c) => `- ${c.name}: ${c.hint}`).join("\n");

function systemPrompt() {
  const company = process.env.COMPANY_NAME?.trim();
  return `You read business documents (invoices, receipts, bills, credit notes) for a small company's bookkeeping archive and return their key details.

Rules:
- vendor: the short trading name of the business that issued the document, e.g. "Amazon", "Trenitalia", "Google Cloud".
- description: what was bought, at most 8 words, e.g. "MacBook Pro 14", "Train Milano–Roma", "Workspace subscription September".
- doc_date: the issue date. Numeric dates on European documents are day/month/year.
- total: the final amount paid or payable, including tax, as a plain number. Use a negative number for credit notes and refunds.
- tax: the total VAT or sales tax if shown.
- currency: ISO 4217 code from symbols or text (€ → EUR, £ → GBP, $ → USD unless the document says otherwise).
- category: the best fit from this list:
${categoryList}
- Most documents are purchases. Only when the document is clearly a sales invoice issued by ${company ? `${company} (the company that owns this archive)` : "the company that owns this archive"} use category "Income" and put the customer in vendor.
- Use null for anything you cannot read. Never invent numbers.`;
}

export type ExtractInput = { data: Buffer; mimeType: string; fileName: string };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export function canExtract(mimeType: string) {
  return mimeType === "application/pdf" || (IMAGE_TYPES as readonly string[]).includes(mimeType);
}

export class ExtractionError extends Error {}

// Claude Opus 5.5 list prices, USD per million tokens.
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

function costUsd(usage: Anthropic.Beta.BetaUsage) {
  const cost =
    usage.input_tokens * PRICE.input +
    usage.output_tokens * PRICE.output +
    (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead;
  return Math.round(cost) / 1_000_000;
}

export async function extractDocument({
  data,
  mimeType,
  fileName,
}: ExtractInput): Promise<{ result: Extraction; costUsd: number }> {
  const client = new Anthropic({ timeout: 55_000, maxRetries: 1 });
  const base64 = data.toString("base64");

  const file: Anthropic.Beta.BetaContentBlockParam =
    mimeType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mimeType as ImageType, data: base64 } };

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(ExtractionSchema) },
    system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [file, { type: "text", text: `File name: ${fileName}` }],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new ExtractionError("The document could not be read.");
  }
  if (!response.parsed_output) {
    throw new ExtractionError("No details found in the document.");
  }
  return { result: clean(response.parsed_output), costUsd: costUsd(response.usage) };
}

function clean(raw: Extraction): Extraction {
  const text = (value: string | null, max: number) => {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    return trimmed ? trimmed.slice(0, max) : null;
  };
  const amount = (value: number | null) =>
    value != null && Number.isFinite(value) && Math.abs(value) < 1e11 ? Math.round(value * 100) / 100 : null;

  const currency = raw.currency?.trim().toUpperCase() ?? null;
  return {
    vendor: text(raw.vendor, 120),
    description: text(raw.description, 160),
    doc_date: validDate(raw.doc_date),
    doc_type: raw.doc_type,
    category: raw.category,
    invoice_number: text(raw.invoice_number, 80),
    total: amount(raw.total),
    tax: amount(raw.tax),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
  };
}

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const valid = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  const thisYear = new Date().getUTCFullYear();
  return valid && y >= 1990 && y <= thisYear + 1 ? value : null;
}
