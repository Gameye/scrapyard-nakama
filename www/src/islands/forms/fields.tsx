import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode
  name: string
  hint?: string // under the input: the rule it has to meet
}

const input =
  'mt-2 w-full rounded border border-white/20 bg-black/30 px-3.5 py-2.5 text-ink placeholder:text-neutral-500 focus-visible:border-red-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500'

function Hint({ id, hint }: { id: string; hint?: string }) {
  if (!hint) return null
  return (
    <p id={`${id}-hint`} className="mt-1.5 text-xs text-neutral-400">
      {hint}
    </p>
  )
}

// A labelled input; its hint is read out with it.
export function Field({ label, name, hint, type = 'text', ...rest }: FieldProps) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="label text-neutral-300">
        {label}
      </label>
      <input id={id} name={name} type={type} aria-describedby={hint ? `${id}-hint` : undefined} className={input} {...rest} />
      <Hint id={id} hint={hint} />
    </div>
  )
}

// A password input with a Show / Hide switch.
export function PasswordField({ label, name, hint, ...rest }: FieldProps) {
  const id = useId()
  const [shown, setShown] = useState(false)
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="label text-neutral-300">
          {label}
        </label>
        <button type="button" onClick={() => setShown(!shown)} aria-pressed={shown} aria-controls={id} className="text-xs font-semibold text-neutral-400 hover:text-ink">
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      <input id={id} name={name} type={shown ? 'text' : 'password'} aria-describedby={hint ? `${id}-hint` : undefined} className={input} {...rest} />
      <Hint id={id} hint={hint} />
    </div>
  )
}

// What a form has to say after a submit: a failure (announced at once) or a success.
export function Outcome({ error, done }: { error?: ReactNode; done?: ReactNode }) {
  return (
    <div aria-live="polite">
      {error && (
        <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}
      {!error && done && <p className="text-sm text-emerald-300">{done}</p>}
    </div>
  )
}
