import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ChatReader, ChatMessage } from './services/chat-reader';
import { HighlightDetector, DetectedHighlight } from './services/highlight-detector';
import { VideoCapture } from './services/video-capture';
import { ClipAssembler } from './services/clip-assembler';
import Dashboard from './components/Dashboard';
import Settings from './components/Settings';

export interface AppState {
  channel: string;
  isConnected: boolean;
  isRecording: boolean;
  sensitivity: number;
  bufferLength: number;
  messages: ChatMessage[];
  highlights: DetectedHighlight[];
  chatRate: number[];
  chatRateTimestamps: number[];
  clips: Blob[];
}

export default function App() {
  const [state, setState] = useState<AppState>({
    channel: '',
    isConnected: false,
    isRecording: false,
    sensitivity: 0.7,
    bufferLength: 30,
    messages: [],
    highlights: [],
    chatRate: [],
    chatRateTimestamps: [],
    clips: [],
  });

  const [showSettings, setShowSettings] = useState(false);

  const chatReaderRef = useRef<ChatReader | null>(null);
  const detectorRef = useRef<HighlightDetector | null>(null);
  const videoCaptureRef = useRef<VideoCapture | null>(null);

  // Update detector sensitivity when it changes
  useEffect(() => {
    if (detectorRef.current) {
      detectorRef.current.setSensitivity(state.sensitivity);
    }
  }, [state.sensitivity]);

  const connect = useCallback(async (channel: string) => {
    if (chatReaderRef.current) {
      chatReaderRef.current.disconnect();
    }

    const reader = new ChatReader(channel);
    const detector = new HighlightDetector(state.sensitivity);

    chatReaderRef.current = reader;
    detectorRef.current = detector;

    reader.onMessage((msg) => {
      const result = detector.addMessage(msg);

      setState((prev) => {
        const newMessages = [...prev.messages.slice(-500), msg];
        const newRate = [...prev.chatRate.slice(-120), result.currentRate];
        const newTimestamps = [...prev.chatRateTimestamps.slice(-120), Date.now()];

        const newState: AppState = {
          ...prev,
          messages: newMessages,
          chatRate: newRate,
          chatRateTimestamps: newTimestamps,
        };

        if (result.highlight) {
          newState.highlights = [...prev.highlights, result.highlight];

          // Auto-clip if recording
          if (prev.isRecording && videoCaptureRef.current) {
            const blob = videoCaptureRef.current.getBuffer();
            if (blob) {
              const clip = ClipAssembler.assembleClip(blob);
              newState.clips = [...prev.clips, clip];
            }
          }
        }

        return newState;
      });
    });

    await reader.connect();
    setState((prev) => ({ ...prev, channel, isConnected: true }));
  }, [state.sensitivity]);

  const disconnect = useCallback(() => {
    chatReaderRef.current?.disconnect();
    chatReaderRef.current = null;
    detectorRef.current = null;
    setState((prev) => ({
      ...prev,
      isConnected: false,
      messages: [],
      chatRate: [],
      chatRateTimestamps: [],
    }));
  }, []);

  const startRecording = useCallback(async () => {
    const capture = new VideoCapture(state.bufferLength);
    try {
      await capture.start();
      videoCaptureRef.current = capture;
      setState((prev) => ({ ...prev, isRecording: true }));
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  }, [state.bufferLength]);

  const stopRecording = useCallback(() => {
    videoCaptureRef.current?.stop();
    videoCaptureRef.current = null;
    setState((prev) => ({ ...prev, isRecording: false }));
  }, []);

  const manualClip = useCallback(() => {
    if (videoCaptureRef.current) {
      const blob = videoCaptureRef.current.getBuffer();
      if (blob) {
        const clip = ClipAssembler.assembleClip(blob);
        setState((prev) => ({ ...prev, clips: [...prev.clips, clip] }));
      }
    }
  }, []);

  const updateSettings = useCallback((updates: Partial<AppState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0e0e10',
      color: '#efeff1',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 24px',
        borderBottom: '1px solid #1f1f23',
        background: '#18181b',
      }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>
          TwitchSnipBot
        </h1>
        <button
          onClick={() => setShowSettings(!showSettings)}
          style={{
            background: 'none',
            border: '1px solid #3a3a3d',
            color: '#efeff1',
            padding: '6px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Settings
        </button>
      </header>

      {showSettings ? (
        <Settings
          sensitivity={state.sensitivity}
          bufferLength={state.bufferLength}
          onUpdate={updateSettings}
          onClose={() => setShowSettings(false)}
        />
      ) : (
        <Dashboard
          state={state}
          onConnect={connect}
          onDisconnect={disconnect}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          onManualClip={manualClip}
        />
      )}
    </div>
  );
}
