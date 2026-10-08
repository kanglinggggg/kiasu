import type { NextConfig } from 'next';
// Local Next server keeps optional API credentials out of the browser.
const config: NextConfig = { images: { unoptimized: true } };
export default config;
