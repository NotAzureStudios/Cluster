import type { AudioOutputMode } from "@cluster/shared";

export class AudioMonitoringGraph {
  private context: AudioContext;
  private source: MediaElementAudioSourceNode;
  private analyser: AnalyserNode;
  private routingNodes: AudioNode[] = [];
  private outputMode: AudioOutputMode = "stereo";
  private sampleBuffer: Float32Array<ArrayBuffer>;

  constructor(element: HTMLMediaElement) {
    const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) throw new Error("Web Audio is not available in this runtime.");
    this.context = new Context();
    this.source = this.context.createMediaElementSource(element);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.72;
    this.sampleBuffer = new Float32Array(this.analyser.fftSize);
    this.reconnect();
    element.addEventListener("play", this.resume);
    this.cleanupPlayListener = () => element.removeEventListener("play", this.resume);
  }

  private cleanupPlayListener: () => void = () => undefined;
  private resume = () => { void this.context.resume().catch(() => undefined); };

  setOutputMode(mode: AudioOutputMode) {
    if (this.outputMode === mode) return;
    this.outputMode = mode;
    this.reconnect();
  }

  meter() {
    this.analyser.getFloatTimeDomainData(this.sampleBuffer);
    let sum = 0;
    let peak = 0;
    for (let index = 0; index < this.sampleBuffer.length; index += 1) {
      const value = Math.abs(this.sampleBuffer[index]);
      sum += value * value;
      peak = Math.max(peak, value);
    }
    return { rms: Math.sqrt(sum / Math.max(1, this.sampleBuffer.length)), peak };
  }

  async dispose() {
    this.cleanupPlayListener();
    try { this.source.disconnect(); } catch {}
    try { this.analyser.disconnect(); } catch {}
    for (const node of this.routingNodes) { try { node.disconnect(); } catch {} }
    await this.context.close().catch(() => undefined);
  }

  private reconnect() {
    try { this.source.disconnect(); } catch {}
    try { this.analyser.disconnect(); } catch {}
    for (const node of this.routingNodes) { try { node.disconnect(); } catch {} }
    this.routingNodes = [];

    if (this.outputMode === "stereo") {
      this.source.connect(this.analyser);
    } else if (this.outputMode === "mono") {
      const mono = this.context.createGain();
      mono.channelCount = 1;
      mono.channelCountMode = "explicit";
      mono.channelInterpretation = "speakers";
      const merger = this.context.createChannelMerger(2);
      this.source.connect(mono);
      mono.connect(merger, 0, 0);
      mono.connect(merger, 0, 1);
      merger.connect(this.analyser);
      this.routingNodes.push(mono, merger);
    } else {
      const splitter = this.context.createChannelSplitter(2);
      const merger = this.context.createChannelMerger(2);
      this.source.connect(splitter);
      const sourceChannel = this.outputMode === "left" ? 0 : 1;
      splitter.connect(merger, sourceChannel, 0);
      splitter.connect(merger, sourceChannel, 1);
      merger.connect(this.analyser);
      this.routingNodes.push(splitter, merger);
    }
    this.analyser.connect(this.context.destination);
  }
}
