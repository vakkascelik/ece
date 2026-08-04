import type { NextConfig } from 'next';

const config: NextConfig = {
  // The shared packages ship TypeScript source rather than compiled output, so
  // Next has to transpile them. This is what makes one query layer usable by
  // both the web app and the mobile app without a build step between.
  transpilePackages: ['@ece/core', '@ece/api'],
  reactStrictMode: true,
};

export default config;
