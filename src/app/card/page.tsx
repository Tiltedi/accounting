import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BankView } from "@/components/bank-view";
import { fetchAllTransactions, fetchRules, fetchVendorLinks } from "@/lib/bank";
import { fetchAllDocuments } from "@/lib/documents";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Card · Accounting" };

export default async function CardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const [docs, txs, rules, links] = await Promise.all([
    fetchAllDocuments(supabase),
    fetchAllTransactions(supabase),
    fetchRules(supabase),
    fetchVendorLinks(supabase),
  ]);
  return (
    <BankView
      source="card"
      initialDocs={docs}
      initialTxs={txs}
      initialRules={rules}
      initialLinks={links}
      initialTab={(await searchParams).tab}
      email={String(data.claims.email ?? "")}
    />
  );
}
