import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Onboarding — Your Tesla rental, made easy",
  description:
    "A guided walkthrough that gets you confident behind the wheel of your Tesla rental in minutes.",
  applicationName: "Tesla Rental Onboarding",
  manifest: "/site.webmanifest",
  openGraph: {
    title: "Onboarding — Your Tesla rental, made easy",
    description:
      "A guided walkthrough that gets you confident behind the wheel of your Tesla rental in minutes.",
  },
};

export const viewport: Viewport = {
  themeColor: "#171a20",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
