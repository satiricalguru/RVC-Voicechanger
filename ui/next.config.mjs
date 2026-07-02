/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: '../app/frontend',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
