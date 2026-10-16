// Browser audio for Gemini Live: 16 kHz PCM16 out of the mic, 24 kHz PCM16 into the speaker.

function rms(pcm: ArrayBuffer): number {
  const ints = new Int16Array(pcm);
  let sum = 0;
  for (let i = 0; i < ints.length; i++) sum += (ints[i] / 0x8000) ** 2;
  return Math.sqrt(sum / Math.max(1, ints.length));
}

export class LiveAudio {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  onFrame: (pcm: ArrayBuffer) => void = () => {};
  // Pause between the parent's last loud frame and the first audio back, per turn.
  gaps: number[] = [];
  private lastVoiceAt = 0;
  private waiting = false;
  onPlaybackEnd: () => void = () => {};
  // A sharp rise in microphone energy while Saathi is silent: about three seconds of audio for a label.
  onLoudSound: (clip: ArrayBuffer) => void = () => {};
  private ring: ArrayBuffer[] = [];
  private floor = 0.01;
  private impactAt = 0;
  private impactsSent = 0;
  private collecting = 0;

  async start(): Promise<void> {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    await this.ctx.audioWorklet.addModule("/pcm-worklet.js");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-capture");
    this.node.port.onmessage = (e) => {
      const pcm = e.data as ArrayBuffer;
      const level = rms(pcm);
      if (level > 0.02) {
        this.lastVoiceAt = performance.now();
        this.waiting = true;
      }
      this.watchForImpact(pcm, level);
      this.onFrame(pcm);
    };
    src.connect(this.node);
  }

  // Keep the last 2 seconds; when a frame is far above the usual level and Saathi is not playing audio,
  // wait one more second and hand the clip over. At most 3 per session and one every 15 seconds.
  private watchForImpact(pcm: ArrayBuffer, level: number): void {
    this.ring.push(pcm);
    if (this.ring.length > 75) this.ring.shift();
    if (this.collecting > 0) {
      this.collecting -= 1;
      if (this.collecting === 0) this.onLoudSound(joinFrames(this.ring));
      return;
    }
    const now = performance.now();
    const spike = level > 0.3 && level > this.floor * 12 && !this.speaking;
    if (spike && this.impactsSent < 3 && now - this.impactAt > 15000) {
      this.impactAt = now;
      this.impactsSent += 1;
      this.collecting = 25;
      return;
    }
    this.floor = this.floor * 0.98 + Math.min(level, 0.1) * 0.02;
  }

  // Queue a chunk of 24 kHz PCM16 so chunks play back to back without gaps.
  play(pcm: ArrayBuffer): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.waiting) {
      this.waiting = false;
      this.gaps.push(Math.round(performance.now() - this.lastVoiceAt));
    }
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

  // Median of the measured gaps, or undefined when no turn was heard.
  medianGap(): number | undefined {
    if (this.gaps.length === 0) return undefined;
    const sorted = [...this.gaps].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
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

function joinFrames(frames: ArrayBuffer[]): ArrayBuffer {
  const total = frames.reduce((n, f) => n + f.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const f of frames) {
    out.set(new Uint8Array(f), offset);
    offset += f.byteLength;
  }
  return out.buffer;
}

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
