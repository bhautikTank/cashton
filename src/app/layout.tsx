import type { Metadata } from "next";
import { DM_Sans, Poppins } from "next/font/google";

import Navbar from "@/components/layout/navbar/Navbar";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://thecashton.com"),
  title: {
    default: "TheCashton – Cashback, Coupons & Deals",
    template: "%s | TheCashton",
  },
  description:
    "TheCashton helps you discover stores, deals and coupons, shop online and earn cashback.",
  applicationName: "TheCashton",
  // Short name shown under the icon when the site is added to an iPhone/iPad Home Screen.
  // capable: false keeps normal browser behaviour (Next.js would otherwise default to full-screen web-app mode).
  appleWebApp: { title: "TheCashton", capable: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${dmSans.variable} ${poppins.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-brand-bg font-sans text-brand-ink">
        <Navbar />
        {children}
      </body>
    </html>
  );
}
