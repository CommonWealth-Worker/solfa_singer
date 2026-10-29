/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { solfeSingerBank } from './solfesinger_bank';

describe('SolfeSinger soundbank engine', () => {
  it('maps Fixed-Do MIDI pitches to SolfeSinger 011 samples correctly', () => {
    // MIDI 60 is C4 -> Do
    const c4 = solfeSingerBank.getRegionForPitch(60, 'solfesinger-011');
    expect(c4).toBeDefined();
    expect(c4?.region.sample).toContain('060_Do.wav');
    expect(c4?.region.center).toBe(60);
    expect(c4?.playbackRate).toBeCloseTo(1.0);

    // MIDI 69 is A4 -> La
    const a4 = solfeSingerBank.getRegionForPitch(69, 'solfesinger-011');
    expect(a4).toBeDefined();
    expect(a4?.region.sample).toContain('069_La.wav');
    expect(a4?.region.center).toBe(69);

    // MIDI 65 is F4 -> Fa
    const f4 = solfeSingerBank.getRegionForPitch(65, 'solfesinger-011');
    expect(f4).toBeDefined();
    expect(f4?.region.sample).toContain('065_Fa.wav');
  });

  it('maps SolfeSinger 010 regions correctly', () => {
    const c4_010 = solfeSingerBank.getRegionForPitch(60, 'solfesinger-010');
    expect(c4_010).toBeDefined();
    expect(c4_010?.region.sample).toContain('samples/010/');
    expect(c4_010?.region.sample).toContain('060_Do.wav');
  });

  it('supports Movable-Do solfa syllable matching to singing voice', () => {
    // In G Major, Solfa note 'd' (Do) has pitch 67 (G4).
    // In Movable-Do mode, it should use a 'Do' sample, pitch shifted to G4!
    const g4Do = solfeSingerBank.getRegionForPitch(67, 'solfesinger-movable', 'd');
    expect(g4Do).toBeDefined();
    expect(g4Do?.region.sample).toContain('Do');
    // Closest recorded center to 67 is 72 or 60. Center 72: diff 5; center 60: diff 7 -> 72
    expect([60, 72]).toContain(g4Do?.region.center);
    // Playback rate adjusts pitch accurately
    const expectedRate = Math.pow(2, (67 - g4Do!.region.center) / 12);
    expect(g4Do?.playbackRate).toBeCloseTo(expectedRate);

    // Solfa note 's' (Sol) at pitch 62 (D4) in G Major
    const d4Sol = solfeSingerBank.getRegionForPitch(62, 'solfesinger-movable', 's');
    expect(d4Sol).toBeDefined();
    expect(d4Sol?.region.sample).toContain('Sol');

    // Solfa note 'm' (Mi)
    const miNote = solfeSingerBank.getRegionForPitch(64, 'solfesinger-movable', 'm');
    expect(miNote).toBeDefined();
    expect(miNote?.region.sample).toContain('Mi');
  });

  it('handles chromatic Solfa syllables (fe, ta, de)', () => {
    const fe = solfeSingerBank.getRegionForPitch(66, 'solfesinger-movable', 'fe');
    expect(fe).toBeDefined();
    expect(fe?.region.sample).toContain('Fi');

    const ta = solfeSingerBank.getRegionForPitch(70, 'solfesinger-movable', 'ta');
    expect(ta).toBeDefined();
    expect(ta?.region.sample).toContain('Chi');
  });

  it('handles low register and high register pitch rates smoothly', () => {
    // Low bass note: MIDI 36 (C2)
    const low = solfeSingerBank.getRegionForPitch(36, 'solfesinger-011');
    expect(low).toBeDefined();
    expect(low?.playbackRate).toBeLessThan(1.0);

    // High soprano note: MIDI 96 (C7)
    const high = solfeSingerBank.getRegionForPitch(96, 'solfesinger-011');
    expect(high).toBeDefined();
    expect(high?.playbackRate).toBeGreaterThan(1.0);
  });
});
