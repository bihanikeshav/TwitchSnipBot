/**
 * Browser video capture using getDisplayMedia + MediaRecorder.
 * Maintains a rolling buffer of 1-second Blob chunks.
 */

export class VideoCapture {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private bufferSeconds: number;
  private timeslice = 1000; // 1 second chunks

  constructor(bufferSeconds = 30) {
    this.bufferSeconds = bufferSeconds;
  }

  async start(): Promise<void> {
    // Show the full picker (tabs/windows/screens) so the user can pick the
    // Twitch popup window instead of this tab — otherwise the recording
    // captures the webapp UI on top of the stream.
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      audio: true,
    });

    const mimeType = this.getSupportedMimeType();

    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType,
      videoBitsPerSecond: 2_000_000,
    });

    this.chunks = [];

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);

        // Keep only the rolling buffer
        const maxChunks = this.bufferSeconds;
        if (this.chunks.length > maxChunks) {
          this.chunks = this.chunks.slice(-maxChunks);
        }
      }
    };

    this.mediaRecorder.onstop = () => {
      this.cleanup();
    };

    // Handle stream ending (user stops sharing)
    this.stream.getVideoTracks()[0].onended = () => {
      this.stop();
    };

    this.mediaRecorder.start(this.timeslice);
  }

  stop(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.cleanup();
  }

  getBuffer(): Blob | null {
    if (this.chunks.length === 0) return null;
    const mimeType = this.getSupportedMimeType();
    return new Blob([...this.chunks], { type: mimeType });
  }

  getBufferDuration(): number {
    return this.chunks.length; // each chunk ~1 second
  }

  isActive(): boolean {
    return this.mediaRecorder !== null && this.mediaRecorder.state === 'recording';
  }

  setBufferLength(seconds: number): void {
    this.bufferSeconds = seconds;
  }

  private cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
  }

  private getSupportedMimeType(): string {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return 'video/webm';
  }
}
