import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import LogoMark from "@/components/LogoMark";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FamilyOutings",
  description: "Family-friendly events",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
      </head>
      <body className={`${inter.className} bg-gray-50 text-gray-800`}>
        <div className="min-h-screen flex flex-col">
          <header className="border-b bg-white/80 backdrop-blur">
            <div className="max-w-2xl mx-auto p-6">
              <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
                <div className="flex items-center gap-2">
                  <LogoMark size={28} className="text-gray-900" />
                  <div className="flex items-baseline gap-1">
                    <span className="font-extrabold text-gray-900">Family</span>
                    <span className="font-extrabold" style={{ color: "#14b8a6" }}>Outings</span>
                  </div>
                </div>
                <div className="text-sm" style={{ color: "#14b8a6" }}>
                  Only kid-friendly events, all in one place.
                </div>
              </div>
            </div>
          </header>
          <main className="flex-1">{children}</main>
          <footer className="text-xs text-gray-600 border-t">
            <div className="max-w-2xl mx-auto p-4 flex gap-3">
              <Link href="/(legal)/disclaimer" className="hover:underline">Disclaimer</Link>
              <span>•</span>
              <Link href="/(info)/about" className="hover:underline">About</Link>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
