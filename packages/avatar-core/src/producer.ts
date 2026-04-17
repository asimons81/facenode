import { createRuntimeEventEnvelope } from './events.js';
import type { AvatarEvent, RuntimeEventEnvelope } from './events.js';
import type { Viseme } from './animationController.js';

export interface RuntimeEventProducerOptions {
  source: string;
  startSequence?: number;
  now?: () => number;
  sessionId?: string;
  utteranceId?: string;
}

export interface RuntimeCorrelation {
  sessionId?: string;
  utteranceId?: string;
}

export interface RuntimeEnvelopeAuthoringOptions {
  timestamp?: number;
  sessionId?: string | null;
  utteranceId?: string | null;
}

export interface SpeechStartOptions extends RuntimeEnvelopeAuthoringOptions {
  audioUrl?: string;
}

export interface SpeechChunkOptions extends RuntimeEnvelopeAuthoringOptions {
  text?: string;
  amplitude?: number;
}

export interface VisemeFrameOptions extends RuntimeEnvelopeAuthoringOptions {
  timestamp: number;
  visemes: Array<{ viseme: Viseme; weight: number }>;
}

/**
 * Small shared helper for non-Hermes producers that need to emit a sequenced
 * Runtime Contract v1 event stream without hand-rolling envelopes.
 */
export class RuntimeEventProducer {
  private sequence: number;
  private readonly now: () => number;
  private correlation: RuntimeCorrelation;

  constructor(private readonly options: RuntimeEventProducerOptions) {
    this.sequence = options.startSequence ?? 0;
    this.now = options.now ?? (() => Date.now());
    this.correlation = buildCorrelation(options.sessionId, options.utteranceId);
  }

  get source(): string {
    return this.options.source;
  }

  get currentSequence(): number {
    return this.sequence;
  }

  get currentCorrelation(): RuntimeCorrelation {
    return { ...this.correlation };
  }

  setCorrelation(correlation: RuntimeCorrelation): this {
    this.correlation = buildCorrelation(correlation.sessionId, correlation.utteranceId);
    return this;
  }

  setSession(sessionId: string | undefined): this {
    this.correlation = buildCorrelation(
      sessionId,
      sessionId ? this.correlation.utteranceId : undefined,
    );
    return this;
  }

  setUtterance(utteranceId: string | undefined): this {
    this.correlation = buildCorrelation(this.correlation.sessionId, utteranceId);
    return this;
  }

  clearSession(): this {
    this.correlation = {};
    return this;
  }

  clearUtterance(): this {
    this.correlation = buildCorrelation(this.correlation.sessionId, undefined);
    return this;
  }

  event(event: AvatarEvent, options: RuntimeEnvelopeAuthoringOptions = {}): RuntimeEventEnvelope {
    this.sequence += 1;

    return createRuntimeEventEnvelope(event, buildEnvelopeMetadata({
      source: this.options.source,
      sequence: this.sequence,
      timestamp: options.timestamp ?? this.now(),
      sessionId: resolveCorrelationValue(options.sessionId, this.correlation.sessionId),
      utteranceId: resolveCorrelationValue(options.utteranceId, this.correlation.utteranceId),
    }));
  }

  connected(options?: RuntimeEnvelopeAuthoringOptions): RuntimeEventEnvelope {
    return this.event({ type: 'connected' }, options);
  }

  disconnected(options?: RuntimeEnvelopeAuthoringOptions): RuntimeEventEnvelope {
    return this.event({ type: 'disconnected' }, options);
  }

  listeningStart(options?: RuntimeEnvelopeAuthoringOptions): RuntimeEventEnvelope {
    return this.event({ type: 'listening_start' }, options);
  }

  listeningEnd(options?: RuntimeEnvelopeAuthoringOptions): RuntimeEventEnvelope {
    return this.event({ type: 'listening_end' }, options);
  }

  thinkingStart(options?: RuntimeEnvelopeAuthoringOptions): RuntimeEventEnvelope {
    return this.event({ type: 'thinking_start' }, options);
  }

  thinkingEnd(options?: RuntimeEnvelopeAuthoringOptions): RuntimeEventEnvelope {
    return this.event({ type: 'thinking_end' }, options);
  }

  speechStart(options: SpeechStartOptions = {}): RuntimeEventEnvelope {
    return this.event(
      {
        type: 'speech_start',
        audioUrl: options.audioUrl,
      },
      options,
    );
  }

  speechChunk(options: SpeechChunkOptions = {}): RuntimeEventEnvelope {
    return this.event(
      {
        type: 'speech_chunk',
        text: options.text,
        amplitude: options.amplitude,
      },
      options,
    );
  }

  speechEnd(options?: RuntimeEnvelopeAuthoringOptions): RuntimeEventEnvelope {
    return this.event({ type: 'speech_end' }, options);
  }

  visemeFrame(options: VisemeFrameOptions): RuntimeEventEnvelope {
    return this.event(
      {
        type: 'viseme_frame',
        timestamp: options.timestamp,
        visemes: options.visemes,
      },
      options,
    );
  }

  error(message: string, options?: RuntimeEnvelopeAuthoringOptions): RuntimeEventEnvelope {
    return this.event({ type: 'error', message }, options);
  }
}

export function createRuntimeEventProducer(
  options: RuntimeEventProducerOptions,
): RuntimeEventProducer {
  return new RuntimeEventProducer(options);
}

function resolveCorrelationValue(
  override: string | null | undefined,
  fallback: string | undefined,
): string | undefined {
  if (override === null) return undefined;
  return override ?? fallback;
}

function buildCorrelation(
  sessionId: string | undefined,
  utteranceId: string | undefined,
): RuntimeCorrelation {
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(utteranceId ? { utteranceId } : {}),
  };
}

function buildEnvelopeMetadata(
  metadata: {
    source: string;
    sequence: number;
    timestamp: number;
    sessionId: string | undefined;
    utteranceId: string | undefined;
  },
): {
  source: string;
  sequence: number;
  timestamp: number;
  sessionId?: string;
  utteranceId?: string;
} {
  return {
    source: metadata.source,
    sequence: metadata.sequence,
    timestamp: metadata.timestamp,
    ...(metadata.sessionId ? { sessionId: metadata.sessionId } : {}),
    ...(metadata.utteranceId ? { utteranceId: metadata.utteranceId } : {}),
  };
}
