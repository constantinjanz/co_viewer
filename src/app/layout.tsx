import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Co-Viewer",
  description: "Privater Co-Viewer.",
  robots: { index: false, follow: false, nocache: true },
};
export const viewport: Viewport = { themeColor: "#000000", colorScheme: "dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="de"><body>{children}</body></html>;
}
