// Shown instead of the log-in and register forms to someone already signed in.
export function SignedInAlready({ name }: { name?: string }) {
  return (
    <div className="mt-8 rounded border border-line bg-panel p-6">
      <p className="text-neutral-300">
        You&rsquo;re signed in as <strong className="text-ink">{name}</strong>.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a href="/play" className="button-primary px-5 py-2.5 text-xs">
          Play
        </a>
        <a href="/account" className="button-quiet px-5 py-2.5 text-xs">
          Your account
        </a>
      </div>
    </div>
  )
}
