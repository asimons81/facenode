import type { AvatarEvent } from './events.js';

export interface CaptionSnapshot {
  text: string;
  visible: boolean;
}

export interface CaptionTimelineOptions {
  endHoldMs?: number;
  swapDebounceMs?: number;
}

const DEFAULT_END_HOLD_MS = 720;
const DEFAULT_SWAP_DEBOUNCE_MS = 90;

export class CaptionTimeline {
  private readonly endHoldMs: number;
  private readonly swapDebounceMs: number;
  private currentText = '';
  private visible = false;
  private hideAtMs: number | null = null;
  private pendingText: string | null = null;
  private swapAtMs: number | null = null;

  constructor(options: CaptionTimelineOptions = {}) {
    this.endHoldMs = options.endHoldMs ?? DEFAULT_END_HOLD_MS;
    this.swapDebounceMs = options.swapDebounceMs ?? DEFAULT_SWAP_DEBOUNCE_MS;
  }

  getSnapshot(): CaptionSnapshot {
    return { text: this.currentText, visible: this.visible };
  }

  apply(event: AvatarEvent, nowMs: number): CaptionSnapshot {
    this.flush(nowMs);

    if (event.type === 'speech_chunk' && event.text) {
      if (!this.visible || this.currentText.length === 0) {
        this.currentText = event.text;
        this.visible = true;
      } else if (event.text !== this.currentText) {
        this.pendingText = event.text;
        this.swapAtMs = nowMs + this.swapDebounceMs;
      }

      this.hideAtMs = null;
    }

    if (event.type === 'speech_end') {
      this.hideAtMs = nowMs + this.endHoldMs;
      this.pendingText = null;
      this.swapAtMs = null;
    }

    if (event.type === 'speech_start') {
      this.hideAtMs = null;
    }

    return this.getSnapshot();
  }

  tick(nowMs: number): CaptionSnapshot {
    this.flush(nowMs);
    return this.getSnapshot();
  }

  clear(): CaptionSnapshot {
    this.currentText = '';
    this.visible = false;
    this.hideAtMs = null;
    this.pendingText = null;
    this.swapAtMs = null;
    return this.getSnapshot();
  }

  private flush(nowMs: number): void {
    if (this.swapAtMs !== null && this.pendingText !== null && nowMs >= this.swapAtMs) {
      this.currentText = this.pendingText;
      this.visible = true;
      this.pendingText = null;
      this.swapAtMs = null;
    }

    if (this.hideAtMs !== null && nowMs >= this.hideAtMs) {
      this.clear();
    }
  }
}
