import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FamilyOutings — Portland",
  description: "Family-friendly events around Portland",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-neutral-50 text-neutral-900 min-h-screen`}>
        <div className="min-h-screen flex flex-col">
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
