import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
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
  title: "Fibott",
  description: "Recycle bottles and cans for WiFi vouchers.",
};

// Pinch-to-zoom must stay enabled -- disabling it (maximumScale: 1,
// userScalable: false) is what made panels feel "fixed" on phones, since
// people couldn't zoom in on anything that didn't fit. The iOS/Android
// auto-zoom-on-input-focus this used to guard against is already handled
// properly below (globals.css forces 16px font-size on inputs under 768px),
// so disabling user zoom entirely was never necessary.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
