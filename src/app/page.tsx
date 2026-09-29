import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { fetchAllDocuments } from "@/lib/documents";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const docs = await fetchAllDocuments(supabase);
  return <Dashboard initialDocs={docs} email={String(data.claims.email ?? "")} />;
}
