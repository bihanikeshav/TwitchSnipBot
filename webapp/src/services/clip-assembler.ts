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
  static downloadClip(clip: Blob, filename?: string): void {
    const url = URL.createObjectURL(clip);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `clip_${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Revoke after a delay to allow download to start
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
