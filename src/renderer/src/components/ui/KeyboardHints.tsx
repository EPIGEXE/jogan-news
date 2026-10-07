export function KeyboardHints({ hints }: { hints: { keys: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-caption text-ink-faint">
      {hints.map((h) => (
        <span key={h.keys}>
          <kbd className="font-body font-bold text-ink-secondary">{h.keys}</kbd> {h.label}
        </span>
      ))}
    </div>
  )
}
