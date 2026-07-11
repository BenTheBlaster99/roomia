import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.pinimg.com',
      },
      {
        protocol: 'https',
        hostname: 'pmsotwinvccacownpnpp.supabase.co',
      },
    ],
  },
};

export default nextConfig;
