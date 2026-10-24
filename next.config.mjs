/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Hackathon build: never let lint style block a live demo deploy.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
