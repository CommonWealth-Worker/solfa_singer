/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ParsedScore } from '../types';
import {
  SOLFESINGER_011_REGIONS,
  SOLFESINGER_010_REGIONS,
  SfzKeyRegion,
  PITCH_CLASS_SYLLABLES,
} from './solfesinger_data';

export type PlaybackInstrument =
  | 'solfesinger-011'
  | 'solfesinger-010'
  | 'solfesinger-movable'
  | 'organ';

export type SingingArticulation = 'sustain' | 'decay';

export interface SolfeSingerVoiceNode {
  stop: () => void;
}

// Map solfa syllables (including accidentals/chromatics) to SolfeSinger syllable names
const SOLFA_SYLLABLE_MAP: Record<string, string> = {
  // Major / Natural scale
  d: 'Do',
  do: 'Do',
  r: 'Re',
  re: 'Re',
  m: 'Mi',
  mi: 'Mi',
  f: 'Fa',
  fa: 'Fa',
  s: 'Sol',
  so: 'Sol',
  sol: 'Sol',
  l: 'La',
  la: 'La',
  t: 'Si',
  ti: 'Si',
  si: 'Si',

  // Sharps / Raised degrees
  de: 'De',
  di: 'De',
  ri: 'Li',
  li: 'Li',
  fe: 'Fi',
  fi: 'Fi',
  se: 'Sa',
  si_sharp: 'Sa',

  // Flats / Lowered degrees
  ra: 'De',
  ma: 'Li',
  me: 'Li',
  ba: 'Fi',
  sa: 'Sa',
  ta: 'Chi',
  te: 'Chi',
  chi: 'Chi',
};

// Syllable name to pitch class (0..11)
const SYLLABLE_PITCH_CLASS: Record<string, number> = {
  Do: 0,
  De: 1,
  Re: 2,
  Li: 3,
  Mi: 4,
  Fa: 5,
  Fi: 6,
  Sol: 7,
  Sa: 8,
  La: 9,
  Chi: 10,
  Si: 11,
};

// Available recorded keycenters for each syllable in 011 and 010 (MIDI 48..89)
const RECORDED_SYLLABLE_CENTERS: Record<string, number[]> = {
  Do: [48, 60, 72, 84],
  De: [49, 61, 73, 85],
  Re: [50, 62, 74, 86],
  Li: [51, 63, 75, 87],
  Mi: [52, 64, 76, 88],
  Fa: [53, 65, 77, 89],
  Fi: [54, 66, 78],
  Sol: [55, 67, 79],
  Sa: [56, 68, 80],
  La: [57, 69, 81],
  Chi: [58, 70, 82],
  Si: [59, 71, 83],
};

/**
 * SolfeSinger Soundbank & Audio Engine
 * Handles sample caching, SFZ pitch mapping, and high-fidelity vocal synthesis.
 */
class SolfeSingerSoundbank {
  private bufferCache = new Map<string, AudioBuffer>();
  private inFlightLoads = new Map<string, Promise<AudioBuffer | null>>();
  private isPreloading = false;
  private preloadedScoreKey: string | null = null;

  /**
   * Resolves the primary URL and fallback GitHub raw URL for a sample.
   */
  private getSampleUrls(samplePath: string): { primary: string; fallback: string } {
    const cleanPath = samplePath.startsWith('/') ? samplePath.slice(1) : samplePath;
    return {
      primary: `/soundbanks/solfesinger/${cleanPath}`,
      fallback: `https://raw.githubusercontent.com/Frieve-A/solfesinger/main/${cleanPath}`,
    };
  }

  /**
   * Loads and decodes an audio buffer for a given sample path.
   */
  public async loadBuffer(ctx: AudioContext, samplePath: string): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(samplePath)) {
      return this.bufferCache.get(samplePath)!;
    }

    if (this.inFlightLoads.has(samplePath)) {
      return this.inFlightLoads.get(samplePath)!;
    }

    const loadPromise = (async () => {
      const { primary, fallback } = this.getSampleUrls(samplePath);
      let arrayBuffer: ArrayBuffer | null = null;

      try {
        const res = await fetch(primary);
        if (res.ok) {
          arrayBuffer = await res.arrayBuffer();
        }
      } catch (e) {
        // Fall back to external repository if local asset fails
      }

      if (!arrayBuffer) {
        try {
          const res = await fetch(fallback);
          if (res.ok) {
            arrayBuffer = await res.arrayBuffer();
          }
        } catch (e) {
          // Failed to fetch fallback
        }
      }

      if (!arrayBuffer) {
        return null;
      }

      try {
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        this.bufferCache.set(samplePath, decoded);
        return decoded;
      } catch (e) {
        return null;
      } finally {
        this.inFlightLoads.delete(samplePath);
      }
    })();

    this.inFlightLoads.set(samplePath, loadPromise);
    return loadPromise;
  }

  /**
   * Finds the best SFZ region and playback rate for a given pitch and instrument.
   */
  public getRegionForPitch(
    midiPitch: number,
    instrument: PlaybackInstrument,
    solfaSyllable?: string
  ): { region: SfzKeyRegion; playbackRate: number } | null {
    const is010 = instrument === 'solfesinger-010';
    const regions = is010 ? SOLFESINGER_010_REGIONS : SOLFESINGER_011_REGIONS;

    // Movable-Do Solfa mode: pick sample matching the solfa syllable text
    if (instrument === 'solfesinger-movable' && solfaSyllable) {
      const cleanSyllable = solfaSyllable.trim().toLowerCase();
      const targetSyllableName = SOLFA_SYLLABLE_MAP[cleanSyllable] || 'Do';
      const availableCenters = RECORDED_SYLLABLE_CENTERS[targetSyllableName] || [60];

      // Find the recorded center closest to the requested midi pitch
      let closestCenter = availableCenters[0];
      let minDiff = Math.abs(midiPitch - closestCenter);
      for (const center of availableCenters) {
        const diff = Math.abs(midiPitch - center);
        if (diff < minDiff) {
          minDiff = diff;
          closestCenter = center;
        }
      }

      const region = regions[closestCenter];
      if (region) {
        const playbackRate = Math.pow(2, (midiPitch - region.center) / 12);
        return { region, playbackRate };
      }
    }

    // Standard Fixed-Do mode (011 or 010): Native SolfeSinger mapping
    const boundedPitch = Math.max(21, Math.min(108, Math.round(midiPitch)));
    const region = regions[boundedPitch];
    if (!region) {
      // Fallback to key 60 if pitch not in table
      const fallback = regions[60] || SOLFESINGER_011_REGIONS[60];
      if (!fallback) return null;
      return {
        region: fallback,
        playbackRate: Math.pow(2, (midiPitch - fallback.center) / 12),
      };
    }

    const playbackRate = Math.pow(2, (midiPitch - region.center) / 12);
    return { region, playbackRate };
  }

  /**
   * Pre-fetches all samples needed by a score to guarantee glitch-free polyphonic playback.
   */
  public async prepareScore(
    ctx: AudioContext,
    score: ParsedScore | null,
    instrument: PlaybackInstrument,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    if (!score || instrument === 'organ') return;

    // Collect all unique sample paths needed by notes in the score
    const neededSamples = new Set<string>();

    score.voices.forEach((v) => {
      score.systems.forEach((sys) => {
        const line = sys.voices[v.id];
        if (!line) return;
        line.measures.forEach((m) => {
          m.notes.forEach((n) => {
            if (n.isRest || n.midiPitch <= 0) return;
            const mapping = this.getRegionForPitch(n.midiPitch, instrument, n.syllable);
            if (mapping) {
              neededSamples.add(mapping.region.sample);
            }
          });
        });
      });
    });

    const sampleList = Array.from(neededSamples);
    if (sampleList.length === 0) return;

    let loadedCount = 0;
    await Promise.all(
      sampleList.map(async (samplePath) => {
        await this.loadBuffer(ctx, samplePath);
        loadedCount++;
        if (onProgress) {
          onProgress(loadedCount / sampleList.length);
        }
      })
    );
  }

  /**
   * Schedules or plays a single singing voice note.
   */
  public playNote(
    ctx: AudioContext,
    destination: AudioNode,
    midiPitch: number,
    startTime: number,
    durationSec: number,
    options: {
      instrument: PlaybackInstrument;
      articulation?: SingingArticulation;
      solfaSyllable?: string;
      volumeScale?: number;
    }
  ): SolfeSingerVoiceNode {
    const articulation = options.articulation || 'sustain';
    const mapping = this.getRegionForPitch(midiPitch, options.instrument, options.solfaSyllable);

    if (!mapping) {
      return { stop: () => {} };
    }

    const { region, playbackRate } = mapping;
    const sampleRate = 48000;
    const buffer = this.bufferCache.get(region.sample);

    const gainNode = ctx.createGain();
    gainNode.connect(destination);

    // Compute volume from SFZ volume offset in dB
    const dbOffset = region.vol || 0;
    const baseLinearGain = Math.pow(10, dbOffset / 20);
    const volumeMultiplier = (options.volumeScale ?? 1.0) * 0.42; // Polyphonic mix scaling
    const targetGain = Math.max(0.0001, baseLinearGain * volumeMultiplier);

    let sourceNode: AudioBufferSourceNode | null = null;
    let isStopped = false;

    const startPlayback = (audioBuf: AudioBuffer) => {
      if (isStopped) return;
      sourceNode = ctx.createBufferSource();
      sourceNode.buffer = audioBuf;
      sourceNode.playbackRate.setValueAtTime(playbackRate, startTime);

      const offsetSec = (region.off || 0) / sampleRate;
      const attack = 0.003;
      const release = 0.14;
      const noteEndTime = startTime + durationSec;

      if (articulation === 'sustain') {
        // Sustain mode: loop smoothly between loop_start and loop_end
        if (region.ls > 0 && region.le > region.ls) {
          sourceNode.loop = true;
          sourceNode.loopStart = region.ls / sampleRate;
          sourceNode.loopEnd = region.le / sampleRate;
        }

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(targetGain, startTime + attack);
        gainNode.gain.setValueAtTime(targetGain, Math.max(startTime + attack, noteEndTime - 0.02));
        gainNode.gain.exponentialRampToValueAtTime(0.0001, noteEndTime + release);

        sourceNode.connect(gainNode);
        sourceNode.start(startTime, offsetSec);
        sourceNode.stop(noteEndTime + release + 0.05);
      } else {
        // Decay mode: natural vocal decay
        sourceNode.loop = false;
        const decayTime = Math.min(3.5, durationSec);
        const decayEnd = startTime + decayTime;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(targetGain, startTime + attack);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, decayEnd + release);

        sourceNode.connect(gainNode);
        sourceNode.start(startTime, offsetSec);
        sourceNode.stop(decayEnd + release + 0.05);
      }
    };

    if (buffer) {
      startPlayback(buffer);
    } else {
      // If not yet cached, fetch immediately and start
      this.loadBuffer(ctx, region.sample).then((buf) => {
        if (buf && !isStopped) {
          const now = ctx.currentTime;
          const adjustedStart = Math.max(now, startTime);
          const remainingDur = durationSec - (adjustedStart - startTime);
          if (remainingDur > 0.05) {
            startPlayback(buf);
          }
        }
      });
    }

    return {
      stop: () => {
        isStopped = true;
        try {
          const now = ctx.currentTime;
          gainNode.gain.cancelScheduledValues(now);
          gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
          setTimeout(() => {
            try {
              sourceNode?.stop();
              sourceNode?.disconnect();
              gainNode.disconnect();
            } catch (e) {}
          }, 50);
        } catch (e) {}
      },
    };
  }

  /**
   * Preview a note single-shot (for click on score or piano roll).
   */
  public async previewNote(
    ctx: AudioContext,
    destination: AudioNode,
    midiPitch: number,
    options?: {
      instrument?: PlaybackInstrument;
      solfaSyllable?: string;
      durationSec?: number;
    }
  ): Promise<void> {
    if (midiPitch <= 0) return;
    const instrument = options?.instrument || 'solfesinger-011';
    const duration = options?.durationSec || 0.45;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const mapping = this.getRegionForPitch(midiPitch, instrument, options?.solfaSyllable);
    if (!mapping) return;

    const buffer = await this.loadBuffer(ctx, mapping.region.sample);
    if (!buffer) return;

    this.playNote(ctx, destination, midiPitch, ctx.currentTime, duration, {
      instrument,
      articulation: 'sustain',
      solfaSyllable: options?.solfaSyllable,
      volumeScale: 1.2,
    });
  }

  /**
   * Checks if sample buffers are already in memory.
   */
  public isSampleLoaded(samplePath: string): boolean {
    return this.bufferCache.has(samplePath);
  }
}

export const solfeSingerBank = new SolfeSingerSoundbank();
