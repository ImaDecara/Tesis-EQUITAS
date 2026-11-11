import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Directorio fijo y propio del arranque original; Next nunca recibe una ruta arbitraria.
  ...(process.env.EQUITAS_ORIGINAL_BUILD === '1' ? {
    distDir: 'build/original-next',
    typescript: { tsconfigPath: 'build/original-tsconfig.json' },
  } : {}),
  turbopack: {
    root: path.join(__dirname, '..'),
  },
};

export default nextConfig;
