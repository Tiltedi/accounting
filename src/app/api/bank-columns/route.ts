import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// Maps the columns of an unfamiliar bank CSV. Only a small sample is sent;
// the full file is parsed in the browser.
const column = z.number().int().nullable();
const MappingSchema = z.object({
  header_row: z.number().int().describe("0-based index of the header row, or -1 if there is none"),
  date: z.number().int().describe("Booking/transaction date column"),
  amount: column.describe("Signed or unsigned amount column; null when debit and credit are separate"),
  debit: column,
  credit: column,
  sign: column.describe("Column saying whether money went out or in, e.g. Af/Bij, D/C"),
  counterparty: column,
  description: column,
  account: column.describe("Own account number / IBAN"),
  currency: column,
  date_format: z.enum(["ymd", "dmy", "mdy", "compact"]).describe("compact = YYYYMMDD"),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "This file's layout isn't recognised, and automatic reading is off." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
  const rows = Array.isArray(body?.rows) ? (body.rows as unknown[]).slice(0, 25) : null;
  if (!rows?.length) return Response.json({ error: "Missing rows" }, { status: 400 });
  const sample = rows.map((r, i) => `${i}: ${JSON.stringify(Array.isArray(r) ? r.slice(0, 30).map(String) : [])}`).join("\n");

  try {
    const client = new Anthropic({ timeout: 55_000, maxRetries: 1 });
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(MappingSchema) },
      messages: [
        {
          role: "user",
          content: `These are the first rows of a bank statement export, one JSON array of cells per row, prefixed with the row index. Tell me which 0-based column holds each field. Use null for fields that are absent.\n\n${sample}`,
        },
      ],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return Response.json({ error: "Couldn't recognise this file's layout." }, { status: 422 });
    }
    const m = response.parsed_output;
    return Response.json({
      mapping: {
        headerRow: m.header_row,
        date: m.date,
        amount: m.amount,
        debit: m.debit,
        credit: m.credit,
        sign: m.sign,
        counterparty: m.counterparty,
        description: m.description,
        account: m.account,
        currency: m.currency,
        dateFormat: m.date_format,
      },
    });
  } catch (err) {
    console.error("bank-columns failed", err);
    return Response.json({ error: "Couldn't recognise this file's layout." }, { status: 502 });
  }
}
