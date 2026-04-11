/**
 * Reads real-time amplitude from an HTMLAudioElement via the Web Audio API.
 *
 * Usage:
 *   const analyzer = new AmplitudeAnalyzer();
 *   analyzer.connect(audioElement);
 *   // each frame:
 *   const amp = analyzer.getAmplitude(); // 0–1
 *   // on cleanup:
 *   analyzer.disconnect();
 *
 * If not connected, getAmplitude() returns 0.
 */
export class AmplitudeAnalyzer {
  private audioCtx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;

  get isConnected(): boolean {
    return this.source !== null && this.analyserNode !== null && this.dataArray !== null;
  }

  connect(audioElement: HTMLAudioElement): void {
    this.disconnect();

    try {
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new AudioContext();
      }
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.8;

      this.source = this.audioCtx.createMediaElementSource(audioElement);
      this.source.connect(this.analyserNode);
      this.analyserNode.connect(this.audioCtx.destination);

      this.dataArray = new Uint8Array(new ArrayBuffer(this.analyserNode.frequencyBinCount));
    } catch (err) {
      console.warn('[AmplitudeAnalyzer] Failed to connect:', err);
      this.disconnect();
    }
  }

  disconnect(): void {
    try {
      this.source?.disconnect();
      this.analyserNode?.disconnect();
    } catch {
      // ignore cleanup errors
    }
    this.source = null;
    this.analyserNode = null;
    this.dataArray = null;
  }

  /**
   * Returns current normalised amplitude in [0, 1].
   * Uses time-domain data (RMS of deviation from silence centre).
   */
  getAmplitude(): number {
    if (!this.analyserNode || !this.dataArray) return 0;

    this.analyserNode.getByteTimeDomainData(this.dataArray);

    let sumOfSquares = 0;
    for (const sample of this.dataArray) {
      const normalised = (sample - 128) / 128;
      sumOfSquares += normalised * normalised;
    }
    const rms = Math.sqrt(sumOfSquares / this.dataArray.length);

    // Scale so typical speech (~0.1 RMS) maps to ~0.6 amplitude
    return Math.min(1, rms * 6);
  }
}
