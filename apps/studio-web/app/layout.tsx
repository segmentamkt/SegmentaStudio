import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kiko Studio Cloud Camera",
  description: "Graba por escenas desde el celular, aprueba tomas y organiza cada portafolio en la nube.",
  manifest: "/manifest.webmanifest",
  applicationName: "Kiko Studio",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Kiko Studio" },
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
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
