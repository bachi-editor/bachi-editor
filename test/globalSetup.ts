// Runs once per `vitest` invocation. Corpus-backed suites skip themselves when
// their inputs are absent, which is quiet by design — this banner explains the
// skips so a contributor never mistakes them for a broken checkout.

import { missingResources } from './helpers/resources';

export default function setup(): void {
  const missing = missingResources();
  if (missing.length === 0) return;

  const lines = [
    '',
    'Corpus-backed suites will be skipped: required local resources are missing.',
    ...missing.map((m) => `  - ${m}`),
    '',
    'These are maintainer-held game/server files and user-supplied codecs. They are',
    'never committed or bundled. See .env.example and the README to set them up.',
    'Everything that does not need them still runs and must pass.',
    '',
  ];
  console.warn(lines.join('\n'));
}
