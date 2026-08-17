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
        {/*
          `useSearchParams()` inside TenantConfigProvider requires a Suspense
          ancestor. The fallback here must NOT reuse `children` — Suspense
          renders fallback and the real content as two separate passes during
          SSR streaming, so `fallback={children}` server-rendered the entire
          page twice (two <aside> shells, two account menus, duplicate
          landmarks) and that duplicate DOM survived hydration. A `null`
          fallback keeps the single required boundary without ever rendering
          the page content more than once.
        */}
        <Suspense fallback={null}>
          <TenantConfigProvider>{children}</TenantConfigProvider>
        </Suspense>
      </body>
    </html>
  );
}
