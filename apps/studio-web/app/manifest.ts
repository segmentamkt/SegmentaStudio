import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Segmenta Studio Cloud Camera",
    short_name: "Segmenta Studio",
    description: "Graba por escenas, aprueba tomas y organiza cada portafolio desde el celular.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#070910",
    theme_color: "#070910",
    orientation: "portrait",
    categories: ["photo", "video", "productivity"],
    icons: [
      { src: "/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
