import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CATEGORIES, CATEGORY_NAMES, READ_DOC_TYPES } from "@/lib/categories";

// Reads a document with Claude and returns bookkeeping fields.

export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"] as const;
export type Model = (typeof MODELS)[number];
const MODEL: Model = "claude-opus-5-5";

const ExtractionSchema = z.object({
  vendor: z
    .string()
    .nullable()
    .describe("Business that issued the document (supplier), or the customer for sales invoices"),
  description: z.string().nullable().describe("What was bought, at most 8 words"),
  doc_date: z.string().nullable().describe("Issue date as YYYY-MM-DD"),
  doc_type: z.enum(READ_DOC_TYPES),
  category: z.enum(CATEGORY_NAMES),
  invoice_number: z.string().nullable(),
  total: z.number().nullable().describe("Final amount including tax"),
  tax: z.number().nullable().describe("Total VAT / sales tax"),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. EUR"),
  card_statement: z.boolean().describe("True only for a credit card statement: a periodic overview of many card transactions with an amount to settle"),
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
// List prices, USD per million tokens. A refusal fallback is billed at the
// serving model's rates.
const PRICES: Record<Model, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

function costUsd(usage: Anthropic.Beta.BetaUsage, model: string) {
  const PRICE = PRICES[model as Model] ?? PRICES[MODEL];
  const cost =
    usage.input_tokens * PRICE.input +
    usage.output_tokens * PRICE.output +
    (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead;
  return Math.round(cost) / 1_000_000;
}

function fileBlock({ data, mimeType }: ExtractInput): Anthropic.Beta.BetaContentBlockParam {
  const base64 = data.toString("base64");
  return mimeType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mimeType as ImageType, data: base64 } };
}

async function read<T extends z.ZodType>(input: ExtractInput, schema: T, system: string, maxTokens: number, model: Model = MODEL) {
  const client = new Anthropic({ timeout: 55_000, maxRetries: 1 });
  const response = await client.beta.messages.parse({
    model,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [fileBlock(input), { type: "text", text: `File name: ${input.fileName}` }],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new ExtractionError("The document could not be read.");
  }
  if (!response.parsed_output) {
    throw new ExtractionError("No details found in the document.");
  }
  return { parsed: response.parsed_output as z.infer<T>, costUsd: costUsd(response.usage, response.model) };
}

export async function extractDocument(
  input: ExtractInput,
  model: Model = MODEL,
): Promise<{ result: Extraction; costUsd: number }> {
  const { parsed, costUsd } = await read(input, ExtractionSchema, systemPrompt(), 16000, model);
  return { result: clean(parsed), costUsd };
}

// ----- Credit card statements --------------------------------------------------

const StatementSchema = z.object({
  issuer: z.string().nullable().describe('Bank or card issuer, e.g. "ING"'),
  statement_date: z.string().nullable().describe("Statement date as YYYY-MM-DD"),
  card_last4: z.string().nullable().describe("Last 4 digits of the card number"),
  total_due: z.number().nullable().describe("Amount settled from the bank account for this statement, positive"),
  currency: z.string().nullable().describe("ISO 4217 code of the statement, e.g. EUR"),
  lines: z.array(
    z.object({
      date: z.string().describe("Transaction date as YYYY-MM-DD"),
      merchant: z.string().describe("Short merchant name, e.g. \"Booking.com\", \"Shell\""),
      details: z.string().nullable().describe("Place, and the original amount and currency for foreign purchases, e.g. \"44,03 USD\""),
      amount: z.number().describe("Amount in the statement currency: positive for purchases and fees, negative for refunds"),
    }),
  ),
});

export type StatementExtraction = z.infer<typeof StatementSchema>;

const STATEMENT_PROMPT = `You read credit card statements for a small company's bookkeeping and list every card transaction.

Rules:
- lines: every purchase, fee, interest charge and refund on the statement, in statement order.
- Leave out the previous balance, subtotals, and payments or settlements received from the bank account.
- amount: in the statement currency, positive for purchases and fees, negative for refunds and credits.
- details: where it was bought, plus the original amount and currency for foreign purchases.
- Numeric dates on European statements are day/month/year. If a line shows no year, use the statement's year (or the previous year for December lines on a January statement).
- total_due: the amount that is (or will be) debited from the bank account to settle this statement.
- Use null for anything you cannot read. Never invent numbers.`;

export async function extractCardStatement(input: ExtractInput): Promise<{ result: StatementExtraction; costUsd: number }> {
  const { parsed, costUsd } = await read(input, StatementSchema, STATEMENT_PROMPT, 32000);
  const money = (value: number | null) =>
    value != null && Number.isFinite(value) && Math.abs(value) < 1e9 ? Math.round(value * 100) / 100 : null;
  const currency = parsed.currency?.trim().toUpperCase() ?? null;
  return {
    costUsd,
    result: {
      issuer: parsed.issuer?.trim().slice(0, 80) || null,
      statement_date: validDate(parsed.statement_date),
      card_last4: parsed.card_last4?.replace(/\D/g, "").slice(-4) || null,
      total_due: money(parsed.total_due),
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
      lines: parsed.lines.flatMap((line) => {
        const date = validDate(line.date);
        const amount = money(line.amount);
        if (!date || !amount) return [];
        return [{ date, merchant: line.merchant.replace(/\s+/g, " ").trim().slice(0, 120), details: line.details?.replace(/\s+/g, " ").trim().slice(0, 300) || null, amount }];
      }),
    },
  };
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
    card_statement: raw.card_statement === true,
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
