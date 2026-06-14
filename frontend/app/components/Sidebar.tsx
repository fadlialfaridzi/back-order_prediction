'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  FlaskConical, 
  Package, 
  FileBarChart,
  Activity,
  Menu,
  X
} from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/predict', label: 'Prediksi', icon: FlaskConical },
  { href: '/inventory', label: 'Inventaris', icon: Package },
  { href: '/analysis', label: 'Analisis', icon: FileBarChart },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)]"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        'fixed lg:sticky top-0 left-0 z-40 h-screen w-64 flex flex-col',
        'bg-[var(--color-bg-card)] border-r border-[var(--color-border)]',
        'transition-transform duration-300 ease-out',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        {/* Logo */}
        <div className="p-6 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
              <Activity size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white">MRP System</h1>
              <p className="text-xs text-[var(--color-text-muted)]">Backorder Prediction</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={clsx(
                  'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-[var(--color-primary)]/15 text-[var(--color-primary-light)] shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
                )}
              >
                <item.icon size={18} className={isActive ? 'text-[var(--color-primary-light)]' : ''} />
                {item.label}
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--color-primary)]" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer — Model status */}
        <div className="p-4 border-t border-[var(--color-border)]">
          <div className="px-4 py-3 rounded-xl bg-[var(--color-bg-elevated)]">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-glow" />
              <span className="text-[var(--color-text-muted)]">Model Active</span>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              RF Classifier · t=0.15
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
