'use client';

import { Package, Search, ArrowUpDown } from 'lucide-react';
import { useState, useEffect } from 'react';

interface BarangItem {
  sku: string;
  nama_barang: string;
  kategori_barang: string;
  stok_saat_ini: number;
  lead_time: number;
  in_transit_qty: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export default function InventoryPage() {
  const [data, setData] = useState<BarangItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<keyof BarangItem>('stok_saat_ini');
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/barang`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = data
    .filter(d => d.nama_barang?.toLowerCase().includes(search.toLowerCase()) || d.sku?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av;
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });

  const toggleSort = (key: keyof BarangItem) => {
    if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(true); }
  };

  const cols: [keyof BarangItem, string][] = [['sku','SKU'],['nama_barang','Nama Barang'],['kategori_barang','Kategori'],['stok_saat_ini','Stok'],['lead_time','Lead Time'],['in_transit_qty','In Transit']];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-8 animate-fade-in-up">
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">Data Inventaris</h1>
        <p className="text-[var(--color-text-secondary)] mt-2 text-sm">Daftar barang dari database PostgreSQL.</p>
      </div>
      <div className="glass-card p-4 mb-6 animate-fade-in-up">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input className="input-field pl-10" placeholder="Cari SKU atau nama..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="glass-card overflow-hidden animate-fade-in-up">
        {loading ? (
          <div className="p-12 text-center text-[var(--color-text-muted)]"><Package size={32} className="mx-auto mb-3 animate-pulse-glow" /><p className="text-sm">Memuat data...</p></div>
        ) : error ? (
          <div className="p-12 text-center"><p className="text-sm text-red-400">Gagal: {error}</p><p className="text-xs text-[var(--color-text-muted)] mt-2">Pastikan backend &amp; database aktif.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--color-border)]">
                {cols.map(([key, label]) => (
                  <th key={key} className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase cursor-pointer hover:text-white transition-colors" onClick={() => toggleSort(key)}>
                    <span className="flex items-center gap-1">{label}<ArrowUpDown size={12} className={sortKey === key ? 'text-[var(--color-primary)]' : ''} /></span>
                  </th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--color-text-muted)]">{search ? 'Tidak ditemukan.' : 'Belum ada data.'}</td></tr>
                ) : filtered.map((item, i) => (
                  <tr key={item.sku ?? i} className="hover:bg-[var(--color-bg-hover)] transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-[var(--color-primary-light)]">{item.sku}</td>
                    <td className="px-4 py-3 font-medium text-white">{item.nama_barang}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{item.kategori_barang}</td>
                    <td className="px-4 py-3"><span className={`font-mono font-medium ${item.stok_saat_ini < 50 ? 'text-red-400' : item.stok_saat_ini < 200 ? 'text-yellow-400' : 'text-emerald-400'}`}>{item.stok_saat_ini?.toLocaleString()}</span></td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{item.lead_time} hari</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{item.in_transit_qty?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
