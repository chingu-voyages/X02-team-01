import type { Metadata } from "next";
import { Suspense } from "react";
import { Lato, Poppins } from "next/font/google";
import { AuthProvider } from "@/features/auth/AuthProvider";
import Console from "@/components/layouts/Console";
import "./globals.css";

const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "The Job Hackers Exam Practice",
  description: "Practice Exam Portal",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${lato.variable} ${poppins.variable} font-sans antialiased`}
    >
      <body className="min-h-full flex flex-col bg-brand-surface">
        <AuthProvider>
          <Suspense fallback={<div role="status" className="p-6 text-sm text-brand-text/70">Loading workspace...</div>}>
            <Console>{children}</Console>
          </Suspense>
        </AuthProvider>
      </body>
    </html>
  );
}
