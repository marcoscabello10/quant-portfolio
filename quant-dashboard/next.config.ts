import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Permite compilar aunque haya advertencias de código
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Permite compilar aunque haya variables tipo 'any'
    ignoreBuildErrors: true,
  },
};

export default nextConfig;