/**
 * AudioPlayer — streams an S3 MP3 with a seek handle
 * ==================================================
 * Wraps a native <audio> (streaming via /api/audio/stream, which 302s to a
 * presigned S3 URL so range requests / seeking work). Exposes an imperative
 * `seek(seconds)` so the TranscriptViewer can jump playback to a clicked
 * timestamp, and reports playback position up via onTime for active-segment
 * highlighting.
 */
'use client';

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
} from 'react';
import { formatDuration } from '@/lib/format';

export interface AudioPlayerHandle {
  seek: (seconds: number) => void;
}

interface Props {
  src: string | null;
  label?: string;
  onTime?: (seconds: number) => void;
}

const AudioPlayer = forwardRef<AudioPlayerHandle, Props>(function AudioPlayer(
  { src, label, onTime },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      const el = audioRef.current;
      if (!el) return;
      el.currentTime = seconds;
      void el.play().catch(() => {});
    },
  }));

  // Reset position display whenever the source changes.
  useEffect(() => {
    setCurrent(0);
    setDuration(0);
    setPlaying(false);
  }, [src]);

  if (!src) {
    return (
      <div className="card text-center text-xs text-muted">
        Select a recording to play.
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      {label && <div className="truncate font-mono text-xs text-muted">{label}</div>}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="w-full"
        controls
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCurrent(t);
          onTime?.(t);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div className="flex items-center justify-between font-mono text-2xs text-muted">
        <span>{playing ? '▶ playing' : '❚❚ paused'}</span>
        <span>
          {formatDuration(current)} / {formatDuration(duration)}
        </span>
      </div>
    </div>
  );
});

export default AudioPlayer;
