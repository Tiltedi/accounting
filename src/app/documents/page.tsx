import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Dashboard, type DocumentsLink } from "@/components/dashboard";
import { fetchAllTransactions } from "@/lib/bank";
import { fetchAllDocuments } from "@/lib/documents";
import { fetchInbox } from "@/lib/inbox";
import { quarterMonths } from "@/lib/overview";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Documents · Accounting" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ show?: string; status?: string; quarter?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const params = await searchParams;
  const link: DocumentsLink = {
    show: params.show === "inbox" || params.show === "download" ? params.show : null,
    status: params.status ?? null,
    months: params.quarter ? quarterMonths(params.quarter) : null,
  };
  const [docs, txs, inbox] = await Promise.all([fetchAllDocuments(supabase), fetchAllTransactions(supabase), fetchInbox(supabase)]);
  return <Dashboard initialDocs={docs} initialTxs={txs} initialInbox={inbox} email={String(data.claims.email ?? "")} link={link} />;
}
