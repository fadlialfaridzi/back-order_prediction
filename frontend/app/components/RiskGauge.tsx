'use client';

import { useEffect, useRef } from 'react';

interface RiskGaugeProps {
  probability: number; // 0 - 1
  threshold: number;   // 0 - 1
  status: string;      // "Aman" | "Backorder"
  size?: number;
}

export default function RiskGauge({ probability, threshold, status, size = 240 }: RiskGaugeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const currentVal = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = (size * 0.7) * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size * 0.7}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size * 0.58;
    const radius = size * 0.38;
    const lineWidth = size * 0.06;

    const startAngle = Math.PI;
    const endAngle = 2 * Math.PI;

    function draw(value: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, size, size * 0.7);

      // Background arc
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.strokeStyle = '#1f1f2e';
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Gradient arc (green → yellow → red)
      const gradient = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
      gradient.addColorStop(0, '#10b981');
      gradient.addColorStop(0.4, '#f59e0b');
      gradient.addColorStop(0.7, '#ef4444');
      gradient.addColorStop(1, '#dc2626');

      const angle = startAngle + value * Math.PI;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, Math.min(angle, endAngle));
      ctx.strokeStyle = gradient;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Threshold marker line
      const threshAngle = startAngle + threshold * Math.PI;
      const innerR = radius - lineWidth * 1.2;
      const outerR = radius + lineWidth * 1.2;
      ctx.beginPath();
      ctx.moveTo(
        cx + innerR * Math.cos(threshAngle),
        cy + innerR * Math.sin(threshAngle)
      );
      ctx.lineTo(
        cx + outerR * Math.cos(threshAngle),
        cy + outerR * Math.sin(threshAngle)
      );
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.lineCap = 'butt';
      ctx.stroke();

      // Needle dot
      const needleAngle = startAngle + value * Math.PI;
      const dotX = cx + radius * Math.cos(needleAngle);
      const dotY = cy + radius * Math.sin(needleAngle);

      ctx.beginPath();
      ctx.arc(dotX, dotY, lineWidth * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(dotX, dotY, lineWidth * 0.4, 0, Math.PI * 2);
      const dotColor = value >= threshold ? '#ef4444' : '#10b981';
      ctx.fillStyle = dotColor;
      ctx.fill();
    }

    // Animate
    const target = probability;
    const startVal = currentVal.current;
    const duration = 800;
    const startTime = performance.now();

    function animate(time: number) {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const val = startVal + (target - startVal) * eased;
      currentVal.current = val;
      draw(val);
      if (progress < 1) {
        animRef.current = requestAnimationFrame(animate);
      }
    }

    animRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animRef.current);
  }, [probability, threshold, size]);

  const isBackorder = status === 'Backorder';
  const pct = (probability * 100).toFixed(1);

  return (
    <div className="flex flex-col items-center">
      <canvas ref={canvasRef} />
      <div className="flex flex-col items-center -mt-4">
        <span className="text-3xl font-bold tracking-tight" style={{
          color: isBackorder ? '#ef4444' : '#10b981',
        }}>
          {pct}%
        </span>
        <span className={`text-sm font-semibold mt-1 px-3 py-1 rounded-full ${
          isBackorder
            ? 'bg-red-500/15 text-red-400'
            : 'bg-emerald-500/15 text-emerald-400'
        }`}>
          {isBackorder ? '⚠ BACKORDER' : '✓ AMAN'}
        </span>
        <span className="text-xs text-[var(--color-text-muted)] mt-1">
          Threshold: {(threshold * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
