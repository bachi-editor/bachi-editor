import { beforeEach, describe, expect, test } from 'vitest';
import { useAppStore } from '../../src/model/store';

const s = () => useAppStore.getState();

function resetSetup() {
  useAppStore.setState({
    project: { kind: 'idle' },
    setup: { remembered: false, datatableKey: '', fumenKey: '', busy: false },
  });
}

beforeEach(resetSetup);

describe('UI language', () => {
  test('setUiLang updates the store and drives the song-title locale', () => {
    s().setUiLang('ja');
    expect(s().ui.uiLang).toBe('ja');
    expect(s().ui.locale).toBe('japaneseText');
    s().setUiLang('zh-Hant');
    expect(s().ui.uiLang).toBe('zh-Hant');
    expect(s().ui.locale).toBe('chineseTText');
    s().setUiLang('en');
    expect(s().ui.locale).toBe('englishUsText');
  });
});

describe('project setup reducers', () => {
  test('setupSetKey updates one key and clears the previous error', () => {
    useAppStore.setState({
      setup: { ...s().setup, error: { field: 'datatable', reason: 'decrypt' } },
    });
    s().setupSetKey('datatable', 'abc');
    expect(s().setup.datatableKey).toBe('abc');
    expect(s().setup.fumenKey).toBe('');
    expect(s().setup.error).toBeUndefined();

    s().setupSetKey('fumen', 'def');
    expect(s().setup.fumenKey).toBe('def');
  });

  test('setupOpenProject is a no-op without a chosen folder', async () => {
    await s().setupOpenProject();
    expect(s().project.kind).toBe('idle');
    expect(s().setup.busy).toBe(false);
  });
});
