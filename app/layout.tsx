import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { Suspense } from "react";
import { TenantConfigProvider } from "@/components/TenantConfigProvider";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "evhost.app — Tesla rental hosting",
  description:
    "Workspace-branded guest onboarding, fleet access, and operations for Tesla rental hosts.",
  applicationName: "evhost.app",
  manifest: "/site.webmanifest",
  openGraph: {
    title: "evhost.app — Tesla rental hosting",
    description:
      "Workspace-branded guest onboarding, fleet access, and operations for Tesla rental hosts.",
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
    <html lang="en" className={manrope.variable}>
      <body>
        <Suspense fallback={children}>
          <TenantConfigProvider>{children}</TenantConfigProvider>
        </Suspense>
      </body>
    </html>
  );
}
