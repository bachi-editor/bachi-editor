import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const PREFIX = 'BACHI_';

/** BACHI_-prefixed variables already present in the shell environment. */
function shellEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[0].startsWith(PREFIX) && entry[1] !== undefined,
    ),
  );
}

export default defineConfig(({ mode }) => {
  // Local-only corpus paths and AES keys come from .env (gitignored). Only the
  // BACHI_ prefix is read, so nothing else in the environment leaks into tests.
  // An explicit shell variable beats the .env file, which is the least
  // surprising order for one-off runs.
  const env = { ...loadEnv(mode, process.cwd(), PREFIX), ...shellEnv() };

  // `test.env` reaches the test workers, but globalSetup runs here in the config
  // process — assign so the startup banner reports the same view the tests see.
  Object.assign(process.env, env);

  return {
    test: {
      globals: true,
      environment: 'node',
      include: ['test/**/*.test.ts'],
      testTimeout: 60_000,
      env,
      globalSetup: ['test/globalSetup.ts'],
    },
  };
});
