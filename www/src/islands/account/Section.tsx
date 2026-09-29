import type { ReactNode } from 'react'

// One panel of the account page; `danger` rims it in red.
export function Section({ title, note, danger, children }: { title: string; note?: string; danger?: boolean; children: ReactNode }) {
  return (
    <section className={`rounded border bg-panel p-6 sm:p-8 ${danger ? 'border-red-500/40' : 'border-line'}`}>
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      {note && <p className="mt-2 text-sm text-neutral-400">{note}</p>}
      <div className="mt-6">{children}</div>
    </section>
  )
}
