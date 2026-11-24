import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nellyadi 574229 — Open-World Sandbox · Jetpack Arena",
  description: "3D open-world sandbox with a jetpack, weapons and real online multiplayer.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black text-white antialiased">{children}</body>
    </html>
  );
}
