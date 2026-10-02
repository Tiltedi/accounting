import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Accounting" };

export default function LoginPage() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-10">
      <div aria-hidden="true" className="ruled absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <div aria-hidden="true" className="absolute top-[-12rem] left-1/2 size-[32rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
      <div className="relative w-full max-w-sm animate-rise rounded-3xl border border-rule bg-card/95 p-7 shadow-[0_1px_0_var(--color-rule),0_32px_64px_-32px_rgb(0_0_0/0.28)] backdrop-blur sm:p-8">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="grid size-16 place-items-center rounded-2xl border border-rule bg-paper shadow-raised">
            <Logo className="size-10" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Accounting</h1>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
