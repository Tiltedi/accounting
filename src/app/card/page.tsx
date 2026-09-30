import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BankView } from "@/components/bank-view";
import { fetchAllTransactions, fetchRules } from "@/lib/bank";
import { fetchAllDocuments } from "@/lib/documents";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Card · Accounting" };

export default async function CardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const [docs, txs, rules] = await Promise.all([fetchAllDocuments(supabase), fetchAllTransactions(supabase), fetchRules(supabase)]);
  return <BankView source="card" initialDocs={docs} initialTxs={txs} initialRules={rules} initialTab={(await searchParams).tab} email={String(data.claims.email ?? "")} />;
}
