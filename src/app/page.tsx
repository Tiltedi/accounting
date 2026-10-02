import { redirect } from "next/navigation";
import { HomeView } from "@/components/home-view";
import { fetchAllTransactions } from "@/lib/bank";
import { todayISO } from "@/lib/dates";
import { fetchAllDocuments } from "@/lib/documents";
import { fetchInbox } from "@/lib/inbox";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const [docs, txs, inbox] = await Promise.all([fetchAllDocuments(supabase), fetchAllTransactions(supabase), fetchInbox(supabase)]);
  return <HomeView docs={docs} txs={txs} initialInbox={inbox} email={String(data.claims.email ?? "")} today={todayISO()} />;
}
