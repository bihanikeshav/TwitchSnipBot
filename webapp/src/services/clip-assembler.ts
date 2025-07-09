/**
 * Assemble Blob buffer into a downloadable clip.
 */

export class ClipAssembler {
  /**
   * Take a blob from the video capture buffer and prepare it as a downloadable clip.
   */
  static assembleClip(bufferBlob: Blob): Blob {
    // The buffer is already a valid WebM/MP4 blob from MediaRecorder
    return bufferBlob;
  }

  /**
   * Trigger browser download of a clip.
   */
  static extensionFor(clip: Blob): string {
    const t = clip.type.toLowerCase();
    if (t.includes('mp2t') || t.includes('mpeg-ts') || t.includes('mp2-ts')) return 'ts';
    if (t.includes('mp4')) return 'mp4';
    if (t.includes('webm')) return 'webm';
    return 'ts';
  }

  static downloadClip(clip: Blob, filename?: string): void {
    const url = URL.createObjectURL(clip);
    const a = document.createElement('a');
    a.href = url;
    const ext = this.extensionFor(clip);
    const base = filename?.replace(/\.[^.]+$/, '') || `clip_${Date.now()}`;
    a.download = `${base}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /**
   * Create a preview URL for in-browser playback.
   */
  static createPreviewUrl(clip: Blob): string {
    return URL.createObjectURL(clip);
  }

  /**
   * Revoke a previously created preview URL.
   */
  static revokePreviewUrl(url: string): void {
    URL.revokeObjectURL(url);
  }
}
