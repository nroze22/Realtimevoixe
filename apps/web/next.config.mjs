/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared package ships TS source — let Next.js transpile it.
  transpilePackages: ['@rtv/shared'],
  webpack(config) {
    // The shared package uses `.js` import suffixes (NodeNext-style) that
    // actually resolve to .ts source. Tell webpack about that alias.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Required for AudioWorklet + getUserMedia in some browser configs.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
};

export default nextConfig;
