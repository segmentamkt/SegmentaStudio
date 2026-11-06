import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/editor/render": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/Inter.ttf"],
    "/api/media/[id]/audio": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
