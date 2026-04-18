import { describe, expect, it } from 'vitest';
import { CaptionTimeline } from './captionTimeline.js';

describe('CaptionTimeline', () => {
  it('holds the last subtitle briefly after speech ends', () => {
    const captions = new CaptionTimeline({ endHoldMs: 500 });

    captions.apply({ type: 'speech_chunk', text: 'Hello there' }, 0);
    expect(captions.getSnapshot()).toEqual({ text: 'Hello there', visible: true });

    captions.apply({ type: 'speech_end' }, 100);
    expect(captions.tick(400)).toEqual({ text: 'Hello there', visible: true });
    expect(captions.tick(601)).toEqual({ text: '', visible: false });
  });

  it('debounces fast chunk replacements so subtitles do not chatter', () => {
    const captions = new CaptionTimeline({ swapDebounceMs: 80 });

    captions.apply({ type: 'speech_chunk', text: 'Hello' }, 0);
    captions.apply({ type: 'speech_chunk', text: 'Hello world' }, 20);

    expect(captions.tick(70)).toEqual({ text: 'Hello', visible: true });
    expect(captions.tick(120)).toEqual({ text: 'Hello world', visible: true });
  });

  it('cancels a pending hide when speech resumes', () => {
    const captions = new CaptionTimeline({ endHoldMs: 500 });

    captions.apply({ type: 'speech_chunk', text: 'Wait' }, 0);
    captions.apply({ type: 'speech_end' }, 100);
    captions.apply({ type: 'speech_start' }, 300);

    expect(captions.tick(700)).toEqual({ text: 'Wait', visible: true });
  });
});
