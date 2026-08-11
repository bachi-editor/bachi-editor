import { describe, expect, test } from 'vitest';
import {
  SHINUCHI_ABSENT,
  SHINUCHI_RENDA_RATE,
  SHINUCHI_TARGET,
  estimateRendaHits,
  shinuchiBonus,
  shinuchiScoring,
} from '../../src/model/shinuchi';

describe('Shin-uchi scoring', () => {
  test('the assumed tapping speed halves the interval from Easy to Oni', () => {
    expect(SHINUCHI_RENDA_RATE).toEqual({
      easy: 6.75,
      normal: 8.4375,
      hard: 11.25,
      oni: 16.875,
      ura: 16.875,
    });
    // Easy takes 2.5× as long per hit as Oni; Ura scores like Oni.
    expect(SHINUCHI_RENDA_RATE.oni / SHINUCHI_RENDA_RATE.easy).toBe(2.5);
    expect(SHINUCHI_RENDA_RATE.ura).toBe(SHINUCHI_RENDA_RATE.oni);
  });

  test('drumroll hits round to the nearest whole hit and never go negative', () => {
    expect(estimateRendaHits(10, 'oni')).toBe(169); // 168.75
    expect(estimateRendaHits(10, 'easy')).toBe(68); // 67.5
    expect(estimateRendaHits(0, 'oni')).toBe(0);
    expect(estimateRendaHits(-5, 'oni')).toBe(0);
    expect(estimateRendaHits(Number.NaN, 'oni')).toBe(0);
  });

  test('the bonus is 100 points per balloon hit plus per expected roll hit', () => {
    expect(shinuchiBonus({ renda: 0, fuusen: 24 }, 'oni')).toBe(2400);
    expect(shinuchiBonus({ renda: 4, fuusen: 0 }, 'oni')).toBe(6800); // round(67.5) = 68
    expect(shinuchiBonus({ renda: 4, fuusen: 24 }, 'oni')).toBe(9200);
  });

  test('a derived base is the smallest multiple of 10 that clears 1,000,000', () => {
    // 500 notes, no bonus: 2000/note lands exactly on the target.
    expect(shinuchiScoring({ notes: 500, renda: 0, fuusen: 0 }, 'oni'))
      .toEqual({ base: 2000, target: SHINUCHI_TARGET });

    // 501 notes needs 1996.0…/note, so 2000 — and overshoots, as shipped charts do.
    const odd = shinuchiScoring({ notes: 501, renda: 0, fuusen: 0 }, 'oni');
    expect(odd.base).toBe(2000);
    expect(odd.target).toBe(1_002_000);
    expect(odd.target).toBeGreaterThan(SHINUCHI_TARGET);

    // The bonus is budgeted out of the million before the base is chosen.
    const withRolls = shinuchiScoring({ notes: 500, renda: 4, fuusen: 24 }, 'oni');
    expect(withRolls.base).toBe(1990); // ceil10((1e6 − 9200) / 500) = ceil10(1981.6)
    expect(withRolls.target).toBe(1990 * 500 + 9200);
    expect(withRolls.target).toBeGreaterThanOrEqual(SHINUCHI_TARGET);
  });

  test('an authored base is kept and the target follows from it', () => {
    expect(shinuchiScoring({ notes: 500, renda: 0, fuusen: 24 }, 'oni', 1780))
      .toEqual({ base: 1780, target: 1780 * 500 + 2400 });
    // A zero/absent authored base falls back to deriving one.
    expect(shinuchiScoring({ notes: 500, renda: 0, fuusen: 0 }, 'oni', 0).base).toBe(2000);
  });

  test('a chart with no tap notes has no per-Good value', () => {
    expect(shinuchiScoring({ notes: 0, renda: 0, fuusen: 7 }, 'oni')).toEqual({ base: 0, target: 700 });
  });

  test('the absent-chart sentinel matches what official songs write', () => {
    expect(SHINUCHI_ABSENT).toBe(1000);
  });
});
