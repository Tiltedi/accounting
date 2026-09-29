import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Accounting" };

export default function LoginPage() {
  return (
    <main className="ruled grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-sm animate-rise rounded-2xl border border-rule bg-card p-7 shadow-[0_1px_0_var(--color-rule),0_24px_48px_-24px_rgb(0_0_0/0.18)] sm:p-8">
        <div className="mb-7 flex items-center gap-3">
          <Logo className="size-9" />
          <span className="text-lg font-semibold tracking-tight">Accounting</span>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
