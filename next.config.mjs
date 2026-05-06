/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    "@kamino-finance/klend-sdk",
    "@kamino-finance/farms-sdk",
    "@orca-so/whirlpools-core",
  ],
};

export default nextConfig;
