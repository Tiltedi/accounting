import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/toaster";
import "./globals.css";

const sans = localFont({
  src: "./fonts/InstrumentSans-Variable.woff2",
  variable: "--font-instrument",
  weight: "400 700",
  display: "swap",
});

const mono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-Regular.woff2", weight: "400" },
    { path: "./fonts/IBMPlexMono-Medium.woff2", weight: "500" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Accounting",
  description: "Scan, sort and find company documents.",
  applicationName: "Accounting",
  appleWebApp: { capable: true, title: "Accounting", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f0" },
    { media: "(prefers-color-scheme: dark)", color: "#121210" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-paper font-sans text-ink antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
