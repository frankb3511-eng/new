/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Server-side fetches go out to public OSINT endpoints.
  // Keep bundle lean; everything runs as route handlers server-side.
};

export default nextConfig;
