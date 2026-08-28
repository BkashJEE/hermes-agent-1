import { type FormEvent, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

function SecureCredentialEntry() {
  const bridge = window.hermesCredential
  const [request, setRequest] = useState<{ envVar: string; prompt: string } | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void bridge?.getRequest().then(setRequest).catch(() => setError('Credential request is no longer available.'))
  }, [bridge])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!bridge || !value) {
      return
    }

    setBusy(true)
    setError('')

    try {
      const result = await bridge.submit(value)

      if (!result.ok) {
        setError(result.error || 'Hermes could not save this credential.')
        setBusy(false)
      }
    } catch {
      setError('Hermes could not save this credential.')
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-5 text-foreground">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl">🔐</div>
          <div>
            <h1 className="text-base font-semibold">Secure credential entry</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This value is saved directly by Hermes Desktop. It is not added to chat or shown to the AI.
            </p>
          </div>
        </div>

        <div className="mb-4 rounded-lg bg-muted/60 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Saving as</div>
          <div className="mt-1 break-all font-mono text-sm">{request?.envVar || 'Loading…'}</div>
          {request?.prompt ? <p className="mt-2 text-sm text-muted-foreground">{request.prompt}</p> : null}
        </div>

        <form className="grid gap-3" onSubmit={submit}>
          <input
            aria-label={request?.envVar || 'Credential'}
            autoComplete="off"
            autoFocus
            className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            disabled={busy || !request}
            onChange={event => setValue(event.target.value)}
            placeholder="Paste token or password"
            spellCheck={false}
            type="password"
            value={value}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <button
              className="h-9 rounded-md px-3 text-sm hover:bg-muted"
              disabled={busy}
              onClick={() => void bridge?.cancel()}
              type="button"
            >
              Cancel
            </button>
            <button
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              disabled={busy || !request || !value}
              type="submit"
            >
              {busy ? 'Saving…' : 'Save securely'}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}

export function mountSecureCredential(): void {
  document.title = 'Secure Credential Entry — Hermes Desktop'
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <SecureCredentialEntry />
    </StrictMode>
  )
}
