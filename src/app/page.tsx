import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { fetchAllTransactions } from "@/lib/bank";
import { fetchAllDocuments } from "@/lib/documents";
import { fetchInbox } from "@/lib/inbox";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const [docs, txs, inbox] = await Promise.all([fetchAllDocuments(supabase), fetchAllTransactions(supabase), fetchInbox(supabase)]);
  return <Dashboard initialDocs={docs} initialTxs={txs} initialInbox={inbox} email={String(data.claims.email ?? "")} />;
}
