import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Forces the session cache off and pins its path into a temp dir, so no
    // test can reach the developer's real ~/.canvas-parent-mcp — see tests/_setup.ts.
    setupFiles: ['./tests/_setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/qr-login-cli.ts', 'src/session-login-cli.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
