import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Imágenes externas permitidas (thumbnails de YouTube, avatares).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  // Paquetes que solo deben correr en el servidor (SDKs pesados).
  serverExternalPackages: ["@anthropic-ai/sdk", "postgres"],
};

export default nextConfig;
