'use client';

/**
 * Voice RO (/intel/voice-ro) — Speech-to-Repair-Order
 * ===================================================
 * Service advisor speaks a natural-language RO description, Web Speech API
 * captures it in real-time, and after 3s of silence the transcript is sent to
 * Claude Haiku which extracts structured RO data (customer, vehicle, services,
 * priority). Results displayed as a structured card with copy-to-clipboard.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface ServiceLine {
  name: string;
  estimated_cost: number | null;
}

interface ExtractedRO {
  customer_name: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_vin: string | null;
  services: ServiceLine[];
  priority: 'routine' | 'urgent' | 'safety' | 'warranty';
  notes: string | null;
}

type Status = 'idle' | 'listening' | 'processing' | 'done' | 'error';

const PRIORITY_BADGE: Record<string, string> = {
  routine: 'bg-blue-500/20 text-blue-300',
  urgent: 'bg-yellow-500/20 text-yellow-300',
  safety: 'bg-red-500/20 text-red-300',
  warranty: 'bg-purple-500/20 text-purple-300',
};

export default function VoiceROPage() {
  const [status, setStatus] = useState<Status>('idle');
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [ro, setRo] = useState<ExtractedRO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [supported, setSupported] = useState(true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check browser support
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
    }
  }, []);

  const sendTranscript = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setStatus('processing');
    setInterim('');
    try {
      const res = await fetch('/api/intel/voice-ro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Extraction failed');
        setStatus('error');
        return;
      }
      setRo(data.ro);
      setStatus('done');
    } catch (err) {
      setError(String((err as Error).message));
      setStatus('error');
    }
  }, []);

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }
      setTranscript(finalTranscript);
      setInterim(interimText);

      // Reset silence timer on any speech activity
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        recognition.stop();
        const fullText = finalTranscript.trim();
        if (fullText) {
          sendTranscript(fullText);
        } else {
          setStatus('idle');
        }
      }, 3000);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== 'aborted') {
        setError(`Speech recognition error: ${event.error}`);
        setStatus('error');
      }
    };

    recognition.onend = () => {
      // If we haven't moved to processing/done, auto-send what we have
      if (status === 'listening' && finalTranscript.trim()) {
        sendTranscript(finalTranscript.trim());
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setStatus('listening');
    setError(null);
    setTranscript('');
    setInterim('');
    setRo(null);
  }, [sendTranscript, status]);

  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    recognitionRef.current?.stop();
    if (transcript.trim()) {
      sendTranscript(transcript.trim());
    } else {
      setStatus('idle');
    }
  }, [transcript, sendTranscript]);

  const startOver = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    recognitionRef.current?.stop();
    setStatus('idle');
    setTranscript('');
    setInterim('');
    setRo(null);
    setError(null);
    setCopied(false);
  }, []);

  const copyToClipboard = useCallback(() => {
    if (!ro) return;
    const lines = [
      `Customer: ${ro.customer_name || 'N/A'}`,
      `Vehicle: ${[ro.vehicle_year, ro.vehicle_make, ro.vehicle_model].filter(Boolean).join(' ') || 'N/A'}`,
      ro.vehicle_vin ? `VIN: ${ro.vehicle_vin}` : null,
      `Priority: ${ro.priority}`,
      '',
      'Services:',
      ...ro.services.map(
        (s) => `  • ${s.name}${s.estimated_cost != null ? ` — $${s.estimated_cost}` : ''}`,
      ),
      '',
      ro.notes ? `Notes: ${ro.notes}` : null,
      '',
      `Total: $${ro.services.reduce((sum, s) => sum + (s.estimated_cost ?? 0), 0)}`,
    ]
      .filter((l) => l !== null)
      .join('\n');

    navigator.clipboard.writeText(lines).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [ro]);

  if (!supported) {
    return (
      <main className="p-6">
        <h1 className="mb-4 text-2xl font-bold text-fg">🎤 Voice RO</h1>
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-6 text-center">
          <p className="text-lg text-yellow-300">
            Web Speech API is not supported in this browser.
          </p>
          <p className="mt-2 text-sm text-muted">
            Please use Chrome, Edge, or Safari on desktop for voice input.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="p-6">
      <h1 className="mb-2 text-2xl font-bold text-fg">🎤 Voice RO</h1>
      <p className="mb-6 text-sm text-muted">
        Speak a repair order description. AI extracts customer, vehicle, and services automatically.
      </p>

      {/* Mic Button */}
      <div className="mb-6 flex items-center gap-4">
        {status === 'idle' || status === 'done' || status === 'error' ? (
          <button
            onClick={startListening}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-cyan/20 text-4xl transition-all hover:bg-cyan/30 hover:scale-105 active:scale-95"
            aria-label="Start listening"
          >
            🎙️
          </button>
        ) : status === 'listening' ? (
          <button
            onClick={stopListening}
            className="flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-red-500/20 text-4xl transition-all hover:bg-red-500/30"
            aria-label="Stop listening"
          >
            ⏹️
          </button>
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-2 text-4xl">
            ⏳
          </div>
        )}

        <div className="text-sm text-muted">
          {status === 'idle' && 'Tap the mic and speak your RO'}
          {status === 'listening' && (
            <span className="text-cyan">Listening… (stops after 3s silence)</span>
          )}
          {status === 'processing' && <span className="text-yellow-300">Extracting RO data…</span>}
          {status === 'done' && <span className="text-green-400">✓ RO extracted</span>}
          {status === 'error' && <span className="text-red-400">Error — try again</span>}
        </div>
      </div>

      {/* Transcript Display */}
      {(transcript || interim) && (
        <div className="mb-6 rounded-lg border border-border bg-surface p-4">
          <p className="mb-1 text-xs font-medium uppercase text-muted">Transcript</p>
          <p className="text-fg">
            {transcript}
            {interim && <span className="text-muted italic">{interim}</span>}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Extracted RO Card */}
      {ro && (
        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-fg">Extracted Repair Order</h2>
            <span
              className={`rounded-full px-3 py-0.5 text-xs font-medium ${PRIORITY_BADGE[ro.priority] || PRIORITY_BADGE.routine}`}
            >
              {ro.priority}
            </span>
          </div>

          {/* Customer & Vehicle */}
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase text-muted">Customer</p>
              <p className="text-fg">{ro.customer_name || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted">Vehicle</p>
              <p className="text-fg">
                {[ro.vehicle_year, ro.vehicle_make, ro.vehicle_model].filter(Boolean).join(' ') ||
                  '—'}
              </p>
              {ro.vehicle_vin && (
                <p className="text-xs text-muted">VIN: {ro.vehicle_vin}</p>
              )}
            </div>
          </div>

          {/* Services Table */}
          <div className="mb-4">
            <p className="mb-2 text-xs font-medium uppercase text-muted">Services</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="pb-2">Service</th>
                  <th className="pb-2 text-right">Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                {ro.services.map((s, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-2 text-fg">{s.name}</td>
                    <td className="py-2 text-right text-fg">
                      {s.estimated_cost != null ? `$${s.estimated_cost}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <td className="pt-2 text-fg">Total</td>
                  <td className="pt-2 text-right text-cyan">
                    ${ro.services.reduce((sum, s) => sum + (s.estimated_cost ?? 0), 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Notes */}
          {ro.notes && (
            <div className="mb-4">
              <p className="text-xs font-medium uppercase text-muted">Notes</p>
              <p className="text-sm text-fg">{ro.notes}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={copyToClipboard}
              className="rounded-md bg-cyan/20 px-4 py-2 text-sm font-medium text-cyan transition-colors hover:bg-cyan/30"
            >
              {copied ? '✓ Copied!' : '📋 Copy to Clipboard'}
            </button>
            <button
              onClick={startOver}
              className="rounded-md bg-surface-2 px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2/80 hover:text-fg"
            >
              🔄 Start Over
            </button>
          </div>
        </div>
      )}

      {/* Start Over (when error) */}
      {status === 'error' && (
        <button
          onClick={startOver}
          className="mt-4 rounded-md bg-surface-2 px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-fg"
        >
          🔄 Start Over
        </button>
      )}
    </main>
  );
}
