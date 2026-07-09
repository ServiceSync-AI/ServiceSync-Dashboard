'use client';

import { useState } from 'react';

export default function WeeklyReportClient({
  start,
  end,
}: {
  start: string;
  end: string;
}) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleEmail() {
    setStatus('sending');
    setMessage('');
    try {
      const res = await fetch('/api/intel/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, end }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('sent');
        setMessage(data.message ?? 'Email sent');
      } else {
        setStatus('error');
        setMessage(data.detail ?? data.error ?? 'Failed to send');
      }
    } catch (err) {
      setStatus('error');
      setMessage(String((err as Error).message));
    }
  }

  return (
    <div className="flex items-center gap-3">
      {message && (
        <span
          className={`text-2xs ${status === 'sent' ? 'text-green' : status === 'error' ? 'text-danger' : 'text-muted'}`}
        >
          {message}
        </span>
      )}
      <button
        onClick={handleEmail}
        disabled={status === 'sending'}
        className="rounded-md bg-cyan/10 px-3 py-1.5 text-sm font-medium text-cyan transition-colors hover:bg-cyan/20 disabled:opacity-50"
      >
        {status === 'sending' ? 'Sending…' : status === 'sent' ? '✓ Sent' : '📧 Email Report'}
      </button>
    </div>
  );
}
