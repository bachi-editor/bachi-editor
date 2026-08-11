import { describe, expect, test } from 'vitest';
import packageMetadata from '../../package.json';
import { APP_VERSION, RELEASE_NOTES } from '../../src/releaseNotes';

describe('About release information', () => {
  test('uses package.json as the current version', () => {
    expect(APP_VERSION).toBe(packageMetadata.version);
    expect(RELEASE_NOTES[0]?.version).toBe(APP_VERSION);
  });

  test('keeps changelog entries newest-first with valid, unique metadata', () => {
    const versions = new Set<string>();
    let previousDate = '9999-12-31';

    for (const release of RELEASE_NOTES) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
      expect(versions.has(release.version)).toBe(false);
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${release.date}T00:00:00Z`))).toBe(false);
      expect(release.date <= previousDate).toBe(true);
      expect(release.changeKeys.length).toBeGreaterThan(0);

      versions.add(release.version);
      previousDate = release.date;
    }
  });
});
