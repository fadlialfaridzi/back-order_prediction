'use client';

import { Package, Search, ArrowUpDown, RefreshCw, PlayCircle, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getBarang,
  getPredictLog,
  runAllPredictions,
  type BarangItem,
  type LogPrediksiItem,
} from '../lib/api';

// Gabungkan data barang dengan log prediksi terakhir per SKU
type BarangWithPrediksi = BarangItem & {
  probabilitas_backorder?: number;
  status?: string;
  is_backorder?: boolean;
  tanggal_prediksi?: string;
};

type SortKey = keyof BarangWithPrediksi;

const PAGE_SIZES = [25, 50, 100];

export default function InventoryPage() {
  const [data,    setData]    = useState<BarangWithPrediksi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [search,  setSearch]  = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('stok_saat_ini');
  const [sortAsc, setSortAsc] = useState(true);
  const [running, setRunning] = useState(false);
  const [runMsg,  setRunMsg]  = useState<string | null>(null);

  // Pagination
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Muat data barang + log prediksi, gabungkan per SKU
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [barang, logs] = await Promise.all([getBarang(), getPredictLog()]);

      const logMap = new Map<string, LogPrediksiItem>(
        logs.map(l => [l.sku, l])
      );

      const merged: BarangWithPrediksi[] = barang.map(b => ({
        ...b,
        ...(logMap.has(b.sku) ? {
          probabilitas_backorder: Number(logMap.get(b.sku)!.probabilitas_backorder),
          status:                 logMap.get(b.sku)!.status,
          is_backorder:           logMap.get(b.sku)!.is_backorder,
          tanggal_prediksi:       logMap.get(b.sku)!.tanggal_prediksi,
        } : {}),
      }));

      setData(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Jalankan prediksi untuk semua item dan simpan ke log_prediksi
  const handleRunAll = async () => {
    setRunning(true);
    setRunMsg(null);
    try {
      const result = await runAllPredictions();
      setRunMsg(
        `Selesai: ${result.written} item diprediksi ` +
        `(${result.summary.backorder} backorder, threshold ${(result.threshold_used * 100).toFixed(0)}%).`
      );
      await loadData(); // refresh tabel
    } catch (e) {
      setRunMsg(`Gagal: ${e instanceof Error ? e.message : 'Terjadi kesalahan.'}`);
    } finally {
      setRunning(false);
    }
  };

  // Filter + sort (memoized)
  const filtered = useMemo(() => {
    return data
      .filter(d =>
        d.nama_barang?.toLowerCase().includes(search.toLowerCase()) ||
        d.sku?.toLowerCase().includes(search.toLowerCase()) ||
        d.kategori_barang?.toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av;
        if (typeof av === 'boolean' && typeof bv === 'boolean') return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
        return sortAsc
          ? String(av ?? '').localeCompare(String(bv ?? ''))
          : String(bv ?? '').localeCompare(String(av ?? ''));
      });
  }, [data, search, sortKey, sortAsc]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const startIdx   = (safePage - 1) * pageSize;
  const paginated  = filtered.slice(startIdx, startIdx + pageSize);

  // Reset page saat search berubah
  useEffect(() => { setPage(1); }, [search, pageSize]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(s => !s);
    else { setSortKey(key); setSortAsc(true); }
  };

  const nBackorder = data.filter(d => d.is_backorder).length;
  const nPredicted = data.filter(d => d.status !== undefined).length;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 animate-fade-in-up">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">Data Inventaris</h1>
            <p className="text-[var(--color-text-secondary)] mt-2 text-sm">
              {nPredicted > 0
                ? `${nPredicted} item terprediksi — ${nBackorder} berisiko backorder.`
                : 'Jalankan prediksi untuk melihat status risiko setiap item.'}
            </p>
          </div>

          {/* Tombol aksi */}
          <div className="flex gap-3 flex-shrink-0">
            <button
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-white transition-all text-sm"
              onClick={loadData}
              disabled={loading || running}
              title="Refresh data"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] transition-all text-sm font-medium disabled:opacity-60"
              onClick={handleRunAll}
              disabled={running || loading}
            >
              {running
                ? <><Loader2 size={15} className="animate-spin" /> Memproses...</>
                : <><PlayCircle size={15} /> Jalankan Prediksi</>}
            </button>
          </div>
        </div>

        {/* Pesan hasil run-all */}
        {runMsg && (
          <div className={`mt-3 px-4 py-2.5 rounded-xl text-sm ${
            runMsg.startsWith('Gagal')
              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
          }`}>
            {runMsg}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="glass-card p-4 mb-6 animate-fade-in-up">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            className="input-field pl-10"
            placeholder="Cari SKU, nama, atau kategori..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Tabel */}
      <div className="glass-card overflow-hidden animate-fade-in-up">
        {loading ? (
          <div className="p-12 text-center text-[var(--color-text-muted)]">
            <Package size={32} className="mx-auto mb-3 animate-pulse-glow" />
            <p className="text-sm">Memuat data...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center">
            <p className="text-sm text-red-400">Gagal: {error}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-2">Pastikan backend &amp; database aktif.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    {(
                      [
                        ['sku',           'SKU'],
                        ['nama_barang',   'Nama Barang'],
                        ['kategori_barang', 'Kategori'],
                        ['stok_saat_ini', 'Stok'],
                        ['lead_time',     'Lead Time'],
                        ['in_transit_qty','In Transit'],
                        ['probabilitas_backorder', 'Probabilitas'],
                        ['status',        'Status Prediksi'],
                      ] as [SortKey, string][]
                    ).map(([key, label]) => (
                      <th
                        key={key}
                        className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase cursor-pointer hover:text-white transition-colors"
                        onClick={() => toggleSort(key)}
                      >
                        <span className="flex items-center gap-1">
                          {label}
                          <ArrowUpDown size={12} className={sortKey === key ? 'text-[var(--color-primary)]' : ''} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {paginated.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-[var(--color-text-muted)]">
                        {search ? 'Tidak ditemukan.' : 'Belum ada data.'}
                      </td>
                    </tr>
                  ) : paginated.map((item, i) => (
                    <tr key={item.sku ?? i} className="hover:bg-[var(--color-bg-hover)] transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-[var(--color-primary-light)]">{item.sku}</td>
                      <td className="px-4 py-3 font-medium text-white">{item.nama_barang}</td>
                      <td className="px-4 py-3 text-[var(--color-text-secondary)]">{item.kategori_barang}</td>
                      <td className="px-4 py-3">
                        <span className={`font-mono font-medium ${
                          item.stok_saat_ini < 50  ? 'text-red-400' :
                          item.stok_saat_ini < 200 ? 'text-yellow-400' : 'text-emerald-400'
                        }`}>
                          {item.stok_saat_ini?.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-secondary)]">{item.lead_time} hari</td>
                      <td className="px-4 py-3 text-[var(--color-text-secondary)]">{item.in_transit_qty?.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        {item.probabilitas_backorder !== undefined ? (
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-[var(--color-border)]">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.min(item.probabilitas_backorder, 100)}%`,
                                  background: item.probabilitas_backorder >= 50 ? '#ef4444' :
                                              item.probabilitas_backorder >= 15 ? '#f59e0b' : '#10b981',
                                }}
                              />
                            </div>
                            <span className="font-mono text-xs text-[var(--color-text-secondary)]">
                              {item.probabilitas_backorder?.toFixed(1)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--color-text-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {item.status ? (
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                            item.is_backorder
                              ? 'bg-red-500/15 text-red-400'
                              : 'bg-emerald-500/15 text-emerald-400'
                          }`}>
                            {item.is_backorder ? '⚠ Backorder' : '✓ Aman'}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--color-text-muted)]">Belum diprediksi</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 border-t border-[var(--color-border)]">
              {/* Info */}
              <div className="text-xs text-[var(--color-text-muted)]">
                Menampilkan {startIdx + 1}–{Math.min(startIdx + pageSize, filtered.length)} dari {filtered.length} item
                {search && ` (filter dari ${data.length} total)`}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-3">
                {/* Page size selector */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--color-text-muted)]">Per halaman:</span>
                  <select
                    value={pageSize}
                    onChange={e => setPageSize(Number(e.target.value))}
                    className="text-xs px-2 py-1.5 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary)]"
                  >
                    {PAGE_SIZES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* Page navigation */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={14} />
                  </button>

                  {/* Page numbers */}
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (safePage <= 3) {
                      pageNum = i + 1;
                    } else if (safePage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = safePage - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                          pageNum === safePage
                            ? 'bg-[var(--color-primary)] text-white'
                            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-white'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
