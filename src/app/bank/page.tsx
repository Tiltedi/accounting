import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BankView } from "@/components/bank-view";
import { fetchAllTransactions } from "@/lib/bank";
import { fetchAllDocuments } from "@/lib/documents";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Bank · Accounting" };

export default async function BankPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const [docs, txs] = await Promise.all([fetchAllDocuments(supabase), fetchAllTransactions(supabase)]);
  return <BankView initialDocs={docs} initialTxs={txs} email={String(data.claims.email ?? "")} />;
}
