/**
 * Next.js Configuration — Pilot Intelligence Dashboard
 * ====================================================
 * Server-side route handlers use the AWS SDK and Node's child_process (for SSH
 * actions), so those must run on the Node runtime, not the Edge runtime. We keep
 * the AWS SDK external to avoid bundling it into serverless functions.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // AWS SDK + ssh exec are Node-only; keep them external to the bundle.
    serverComponentsExternalPackages: [
      '@aws-sdk/client-s3',
      '@aws-sdk/client-transcribe',
      '@aws-sdk/s3-request-presigner',
    ],
  },
};

module.exports = nextConfig;
