// Capability detection for the File System Access API. The entire app is
// hard-gated on this — we edit a folder of game .bin files in place. The
// API ships in Chromium-based browsers only (Chrome / Edge / Brave / Arc /
// Opera). Safari and Firefox lack it and will hit the BrowserSupportGate.

export interface BrowserSupport {
  ok: boolean;
  reason?: string;
  missing: string[];
}

export function detectBrowserSupport(): BrowserSupport {
  const missing: string[] = [];
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'No window object — not running in a browser.', missing: ['window'] };
  }
  if (typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker !== 'function') {
    missing.push('window.showDirectoryPicker');
  }
  if (typeof (globalThis as unknown as { FileSystemDirectoryHandle?: unknown }).FileSystemDirectoryHandle !== 'function') {
    missing.push('FileSystemDirectoryHandle');
  }
  if (typeof indexedDB === 'undefined') {
    missing.push('indexedDB');
  }
  if (typeof crypto?.subtle?.decrypt !== 'function') {
    missing.push('crypto.subtle');
  }
  if (typeof (globalThis as unknown as { CompressionStream?: unknown }).CompressionStream !== 'function') {
    missing.push('CompressionStream');
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        'This editor needs the File System Access API and a few related web platform features. ' +
        'They are available in Chromium-based browsers (Chrome, Edge, Brave, Arc, Opera).',
      missing,
    };
  }
  return { ok: true, missing: [] };
}
