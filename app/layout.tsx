import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import LogoMark from "@/components/LogoMark";

export const metadata: Metadata = {
  title: "Family Outings",
  description: "Only kid-friendly events, all in one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-slate-900 antialiased">
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-gray-200">
          <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 group">
              <LogoMark className="h-6 w-6" />
              <span className="text-lg font-semibold tracking-tight">
                <span>Family </span>
                <span className="text-teal-600 group-hover:text-teal-700 transition-colors">
                  Outings
                </span>
              </span>
            </Link>
            <p className="hidden sm:block text-sm text-teal-700">
              Only kid-friendly events, all in one place.
            </p>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
