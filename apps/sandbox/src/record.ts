/** Record the canvas to a WebM clip with MediaRecorder (build-in-public clips). */
export class ClipRecorder {
  private recorder: MediaRecorder | undefined;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  start(canvas: HTMLCanvasElement): void {
    const stream = canvas.captureStream(60);
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    this.chunks = [];
    this.recorder = new MediaRecorder(
      stream,
      mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined,
    );
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(250);
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const r = this.recorder;
      if (!r) return resolve(new Blob());
      r.onstop = () => resolve(new Blob(this.chunks, { type: r.mimeType }));
      r.stop();
    });
  }
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
