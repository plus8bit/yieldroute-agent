import type { Metadata } from "next";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import { SolanaProviders } from "@/components/solana-providers";

export const metadata: Metadata = {
  title: "YieldRoute Agent",
  description:
    "Solflare x Kamino x Quicknode MVP for route planning and unsigned transaction generation.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SolanaProviders>{children}</SolanaProviders>
      </body>
    </html>
  );
}
