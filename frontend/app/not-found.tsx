'use client';

import Link from 'next/link';
import { Home, ArrowLeft, SearchX } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-screen p-6">
      <div className="text-center animate-fade-in-up max-w-md">
        {/* Icon */}
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 flex items-center justify-center mx-auto mb-6">
          <SearchX size={40} className="text-[var(--color-primary-light)]" />
        </div>

        {/* Error number */}
        <h1 className="text-7xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent mb-4">
          404
        </h1>

        {/* Message */}
        <h2 className="text-xl font-semibold text-white mb-2">
          Halaman Tidak Ditemukan
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-8">
          Halaman yang Anda cari tidak ada atau telah dipindahkan.
          Periksa kembali URL atau kembali ke dashboard.
        </p>

        {/* Actions */}
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] transition-all text-sm font-medium"
          >
            <Home size={16} />
            Dashboard
          </Link>
          <button
            onClick={() => history.back()}
            className="flex items-center gap-2 px-5 py-3 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-white transition-all text-sm"
          >
            <ArrowLeft size={15} />
            Kembali
          </button>
        </div>

        {/* Decorative elements */}
        <div className="mt-12 flex justify-center gap-2">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-[var(--color-border)]"
              style={{
                animation: 'pulse-glow 2s ease-in-out infinite',
                animationDelay: `${i * 0.3}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
