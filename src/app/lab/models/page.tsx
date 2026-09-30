import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ModelTest } from "@/app/lab/models/model-test";
import { DOC_COLUMNS, type Doc } from "@/lib/documents";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Model test · Accounting" };

// Temporary page: compares the current reader with a lighter model on your
// latest receipts and invoices.
export default async function ModelTestPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const { data: docs } = await supabase
    .from("documents")
    .select(DOC_COLUMNS)
    .eq("status", "ready")
    .neq("doc_type", "statement")
    .order("created_at", { ascending: false })
    .limit(12);
  return <ModelTest docs={(docs ?? []) as Doc[]} />;
}
