import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

// Every page is rendered fresh: a prerendered page kept in Next's route cache outlived a rebuild and pointed at
// scripts that no longer existed ("Application error" after deploys). Data is all client-side anyway.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GAC Desk",
  description: "Client messages, team and tasks in one place",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
