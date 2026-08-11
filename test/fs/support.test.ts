import { afterEach, describe, expect, test, vi } from 'vitest';
import { detectBrowserSupport } from '../../src/fs/support';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectBrowserSupport', () => {
  test('reports a non-browser environment', () => {
    vi.stubGlobal('window', undefined);

    expect(detectBrowserSupport()).toMatchObject({
      ok: false,
      missing: ['window'],
    });
    expect(detectBrowserSupport().reason).toContain('No window object');
  });

  test('reports every missing browser capability', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('FileSystemDirectoryHandle', undefined);
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('crypto', {});
    vi.stubGlobal('CompressionStream', undefined);

    const support = detectBrowserSupport();

    expect(support.ok).toBe(false);
    expect(support.reason).toContain('File System Access API');
    expect(support.missing).toEqual([
      'window.showDirectoryPicker',
      'FileSystemDirectoryHandle',
      'indexedDB',
      'crypto.subtle',
      'CompressionStream',
    ]);
  });

  test('accepts a complete Chromium-like environment', () => {
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn() });
    vi.stubGlobal('FileSystemDirectoryHandle', function FileSystemDirectoryHandle() {});
    vi.stubGlobal('indexedDB', {});
    vi.stubGlobal('crypto', { subtle: { decrypt: vi.fn() } });
    vi.stubGlobal('CompressionStream', function CompressionStream() {});

    expect(detectBrowserSupport()).toEqual({ ok: true, missing: [] });
  });
});
