/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/', destination: '/index.html' },
    ];
  },
};

module.exports = nextConfig;
