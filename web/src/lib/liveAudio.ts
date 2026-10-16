// Browser audio for Gemini Live: 16 kHz PCM16 out of the mic, 24 kHz PCM16 into the speaker.

export class LiveAudio {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  onFrame: (pcm: ArrayBuffer) => void = () => {};
  onPlaybackEnd: () => void = () => {};

  async start(): Promise<void> {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    await this.ctx.audioWorklet.addModule("/pcm-worklet.js");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-capture");
    this.node.port.onmessage = (e) => this.onFrame(e.data as ArrayBuffer);
    src.connect(this.node);
  }

  // Queue a chunk of 24 kHz PCM16 so chunks play back to back without gaps.
  play(pcm: ArrayBuffer): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const ints = new Int16Array(pcm, 0, Math.floor(pcm.byteLength / 2));
    const floats = new Float32Array(ints.length);
    for (let i = 0; i < ints.length; i++) floats[i] = ints[i] / 0x8000;
    const buffer = ctx.createBuffer(1, floats.length, 24000);
    buffer.copyToChannel(floats, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) this.onPlaybackEnd();
    };
  }

  // The parent spoke over Saathi: drop whatever is still queued.
  interrupt(): void {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  get speaking(): boolean {
    return this.sources.size > 0;
  }

  stop(): void {
    this.interrupt();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.node = null;
  }
}
