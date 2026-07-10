'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

interface MPIEstimate {
  part: string;
  condition: string;
  conditionScore: number;
  serviceNeeded: string;
  costRange: { low: number; high: number };
  urgency: 'immediate' | 'soon' | 'monitor';
  customerExplanation: string;
  confidence: number;
}

interface HistoryItem {
  id: string;
  estimate: MPIEstimate;
  analyzedAt: string;
  fileName: string;
  thumbnail?: string;
}

const STORAGE_KEY = 'ss_mpi_history';

function loadHistory(): HistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 50)));
}

const urgencyColors: Record<string, string> = {
  immediate: 'bg-red-500/20 text-red-400 border-red-500/30',
  soon: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  monitor: 'bg-green-500/20 text-green-400 border-green-500/30',
};

const urgencyLabels: Record<string, string> = {
  immediate: '🚨 Immediate',
  soon: '⚠️ Soon',
  monitor: '✅ Monitor',
};

export default function MPIEstimatePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<MPIEstimate | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [customerView, setCustomerView] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setError(null);
    setEstimate(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) handleFile(f);
      else setError('Please drop an image file (JPEG, PNG, WebP)');
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragging(false), []);

  const analyze = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch('/api/intel/mpi-estimate', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Analysis failed');
      setEstimate(data.estimate);

      // Save to history
      const item: HistoryItem = {
        id: crypto.randomUUID(),
        estimate: data.estimate,
        analyzedAt: data.analyzedAt,
        fileName: file.name,
        thumbnail: preview?.slice(0, 200) ?? undefined,
      };
      const updated = [item, ...history];
      setHistory(updated);
      saveHistory(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setEstimate(null);
    setError(null);
    setCustomerView(false);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">📸 MPI Photo Estimate</h1>
          <p className="mt-1 text-sm text-muted">
            Upload a photo of a vehicle part → AI analyzes condition &amp; generates estimate
          </p>
        </div>
        {(file || estimate) && (
          <button
            onClick={reset}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg"
          >
            New Analysis
          </button>
        )}
      </div>

      {/* Upload Area */}
      {!estimate && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all ${
            dragging
              ? 'border-cyan bg-cyan/5'
              : file
                ? 'border-green-500/50 bg-green-500/5'
                : 'border-border hover:border-cyan/50 hover:bg-surface-2'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />

          {preview ? (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Vehicle part preview"
                className="mx-auto max-h-64 rounded-lg object-contain"
              />
              <p className="text-sm text-green-400">✓ {file?.name}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-4xl">📷</div>
              <p className="text-fg">Drop a photo here or click to browse</p>
              <p className="text-xs text-muted">JPEG, PNG, WebP, GIF • Max 10MB</p>
            </div>
          )}
        </div>
      )}

      {/* Analyze Button */}
      {file && !estimate && (
        <button
          onClick={analyze}
          disabled={loading}
          className="w-full rounded-lg bg-cyan px-4 py-3 font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
              Analyzing with AI…
            </span>
          ) : (
            '🔍 Analyze Part Condition'
          )}
        </button>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Results Card */}
      {estimate && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-fg">{estimate.part}</h2>
                <p className="text-sm text-muted">{estimate.condition}</p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-medium ${urgencyColors[estimate.urgency]}`}
              >
                {urgencyLabels[estimate.urgency]}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-xs text-muted">Condition</div>
                <div className="mt-1 text-lg font-bold text-fg">{estimate.conditionScore}/10</div>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-xs text-muted">Cost Range</div>
                <div className="mt-1 text-lg font-bold text-fg">
                  ${estimate.costRange.low}–${estimate.costRange.high}
                </div>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-xs text-muted">Confidence</div>
                <div className="mt-1 text-lg font-bold text-fg">{estimate.confidence}%</div>
              </div>
            </div>

            <div className="rounded-lg bg-surface-2 p-3">
              <div className="text-xs text-muted">Recommended Service</div>
              <div className="mt-1 text-sm text-fg">{estimate.serviceNeeded}</div>
            </div>

            {/* Customer Explanation Toggle */}
            <div>
              <button
                onClick={() => setCustomerView(!customerView)}
                className="w-full rounded-lg bg-cyan/10 border border-cyan/30 px-4 py-2.5 text-sm font-medium text-cyan hover:bg-cyan/20 transition-colors"
              >
                {customerView ? '🙈 Hide' : '👁️ Show'} Customer Explanation
              </button>
              {customerView && (
                <div className="mt-3 rounded-lg border border-cyan/20 bg-cyan/5 p-4">
                  <p className="text-sm leading-relaxed text-fg">
                    {estimate.customerExplanation}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Preview image alongside result */}
          {preview && (
            <div className="rounded-xl border border-border bg-surface p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Analyzed part"
                className="mx-auto max-h-48 rounded-lg object-contain"
              />
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted">Recent Estimates</h3>
            <button
              onClick={clearHistory}
              className="text-xs text-muted hover:text-red-400 transition-colors"
            >
              Clear History
            </button>
          </div>
          <div className="space-y-2">
            {history.slice(0, 10).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${urgencyColors[item.estimate.urgency]}`}
                  >
                    {item.estimate.urgency}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-fg">{item.estimate.part}</div>
                    <div className="text-xs text-muted">{item.fileName}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-fg">
                    ${item.estimate.costRange.low}–${item.estimate.costRange.high}
                  </div>
                  <div className="text-xs text-muted">
                    {new Date(item.analyzedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
