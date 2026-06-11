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
  async redirects() {
    return [
      // La landing de ads vieja se reemplaza por la home; los ads apuntan a
      // /empieza/ruta (el wizard sigue vivo). permanent:false por si se revierte.
      { source: "/empieza", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
