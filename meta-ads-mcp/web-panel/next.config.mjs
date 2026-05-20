/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  outputFileTracingRoot: process.cwd(),
  eslint: {
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
