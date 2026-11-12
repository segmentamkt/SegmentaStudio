import type { Metadata, Viewport } from "next";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "../lib/theme";

export const metadata: Metadata = {
  title: "Segmenta Studio Cloud Camera",
  description: "Graba por escenas desde el celular, aprueba tomas y organiza cada portafolio en la nube.",
  manifest: "/manifest.webmanifest",
  applicationName: "Segmenta Studio",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Segmenta Studio" },
  formatDetection: { telephone: false },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/app-icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070910",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Aplica el modo claro guardado antes de pintar la página. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
