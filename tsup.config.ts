import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/proxy.ts'],
  format: ['cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
});
