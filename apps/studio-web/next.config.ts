import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/scripts/import": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    "/api/editor/render": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/Inter.ttf"],
    "/api/media/[id]/audio": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
