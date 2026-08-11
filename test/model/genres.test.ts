import { describe, expect, test } from 'vitest';
import { compareGameGenreOrder, GAME_GENRE_ORDER, GENRES, genreFor } from '../../src/model/genres';

describe('genre metadata', () => {
  test('covers every known on-disk genre number in order', () => {
    expect(GENRES.map((g) => g.no)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(GENRES.map((g) => g.name)).toEqual([
      'Pops',
      'Anime',
      'Kids',
      'Vocaloid',
      'Game Music',
      'Namco Original',
      'Variety',
      'Classical',
    ]);
    expect(GENRES.every((g) => /^#[0-9a-f]{6}$/i.test(g.color))).toBe(true);
  });

  test('looks up known genres and falls back to Unknown', () => {
    expect(genreFor(5)).toEqual({ no: 5, name: 'Namco Original', color: '#f2843c' });
    expect(genreFor(undefined)).toEqual({ no: -1, name: 'Unknown', color: '#bcb6ab' });
    expect(genreFor(99)).toEqual({ no: -1, name: 'Unknown', color: '#bcb6ab' });
  });

  test('uses the game folder table order independently of enum order', () => {
    expect(GAME_GENRE_ORDER).toEqual([1, 3, 4, 6, 7, 5, 2, 0]);
    expect([0, 99, 5, undefined, 1, 7].sort(compareGameGenreOrder)).toEqual([1, 7, 5, 0, 99, undefined]);
  });
});
