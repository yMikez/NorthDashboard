/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Pretty URLs for the SPA. Each known route is rewritten to the static
  // index.html so the React app boots and reads the path to decide which
  // page to show. Keeps the SPA on a single bundle without exposing
  // /index.html in the address bar.
  async rewrites() {
    return [
      { source: '/', destination: '/index.html' },
      { source: '/overview', destination: '/index.html' },
      { source: '/funnel', destination: '/index.html' },
      { source: '/leaderboard', destination: '/index.html' },
      { source: '/all-affiliates', destination: '/index.html' },
      { source: '/products', destination: '/index.html' },
      { source: '/transactions', destination: '/index.html' },
      { source: '/platforms', destination: '/index.html' },
      { source: '/health', destination: '/index.html' },
    ];
  },
};

module.exports = nextConfig;
