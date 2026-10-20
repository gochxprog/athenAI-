const TONES = {
  off: 'bg-cemento-600',
  idle: 'bg-cemento-400',
  on: 'bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]',
};

export default function StatusIndicator({ label, tone = 'off', className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-cemento-300 ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${TONES[tone]}`} aria-hidden />
      {label}
    </span>
  );
}
