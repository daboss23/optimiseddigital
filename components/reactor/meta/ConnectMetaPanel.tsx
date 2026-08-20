'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, KeyRound, Loader2, PlugZap, Unplug } from 'lucide-react'
import { Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import { FieldLabel, SecondaryButton, inputClass } from '@/components/reactor/operator/shell'
import { cn } from '@/lib/utils'

/* ----------------------------------------------------------------------------
   The Meta connection, managed from the tab it powers.

   A System User token pasted here is validated against the Graph API before
   anything is stored, then saved server-side in platform_settings — it never
   comes back to the browser in full (the API returns its last four characters,
   like a card number on a receipt). Once stored, the connection feeds this
   dashboard, Mike's decision queue and the learning-loop sync; the
   META_ACCESS_TOKEN env var remains the fallback for deployments that would
   rather keep credentials in infrastructure.
---------------------------------------------------------------------------- */

interface ConnectionState {
  connected: boolean
  adAccountId: string | null
  accountName: string | null
  tokenTail: string | null
  connectedAt: string | null
  storageAvailable: boolean
  envFallback: { token: boolean; adAccountId: string | null }
}

interface AccountOption {
  id: string
  name: string
}

export function ConnectMetaPanel({ onConnectionChange }: { onConnectionChange?: () => void }) {
  const [state, setState] = useState<ConnectionState | null>(null)
  const [token, setToken] = useState('')
  const [accountId, setAccountId] = useState('')
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null)
  const [chosenAccount, setChosenAccount] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/operator/meta-connection', { cache: 'no-store' })
      const body = await res.json()
      if (body?.data) setState(body.data as ConnectionState)
    } catch {
      /* the panel keeps its last known state — a failed read invents nothing */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const connect = async (account?: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/operator/meta-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: token,
          adAccountId: account ?? (accountId.trim() || undefined),
        }),
      })
      const body = await res.json()
      // The token can see several accounts and none was chosen — ask which
      // one. Nothing has been stored yet.
      if (body?.needsAccount) {
        setAccounts(body.accounts ?? [])
        setChosenAccount(body.accounts?.[0]?.id ?? '')
        return
      }
      if (!res.ok || !body?.success) {
        setError(body?.error ?? 'The connection could not be saved.')
        return
      }
      setToken('')
      setAccountId('')
      setAccounts(null)
      setShowForm(false)
      await load()
      onConnectionChange?.()
    } catch {
      setError('The connection request failed — check your network and try again.')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setError(null)
    try {
      await fetch('/api/operator/meta-connection', { method: 'DELETE' })
      await load()
      onConnectionChange?.()
    } finally {
      setBusy(false)
    }
  }

  const connectedDate = state?.connectedAt
    ? new Date(state.connectedAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null

  return (
    <Panel className="mt-3">
      <PanelHeader
        icon={<PlugZap size={16} />}
        accent="blue"
        title="Meta Connection"
        subtitle="The System User token every live figure on this tab is read with"
        accessory={
          state?.connected ? (
            <Pill tone="success">
              <Check size={12} />
              Connected
            </Pill>
          ) : state?.envFallback.token ? (
            <Pill tone="primary">Env token active</Pill>
          ) : (
            <Pill tone="warning">Not connected</Pill>
          )
        }
      />

      <div className="space-y-4 p-5">
        {/* Loading — one quiet line, not a spinner farm. */}
        {!state && (
          <p className="flex items-center gap-2 text-[13px] text-white/45">
            <Loader2 size={13} className="animate-spin" />
            Reading the connection…
          </p>
        )}

        {/* Connected via the stored connection. */}
        {state?.connected && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-white">
                {state.accountName ?? 'Meta ad account'}
                <span className="ml-2 font-mono text-[12px] font-normal text-white/45">
                  act_{state.adAccountId}
                </span>
              </p>
              <p className="mt-1 text-[12.5px] text-white/55">
                Token ••••{state.tokenTail}
                {connectedDate ? ` · connected ${connectedDate}` : ''}
                {state.envFallback.token && ' · the env token is now the fallback'}
              </p>
            </div>
            <SecondaryButton tone="danger" onClick={disconnect} disabled={busy}>
              <span className="inline-flex items-center gap-1.5">
                <Unplug size={13} />
                Disconnect
              </span>
            </SecondaryButton>
          </div>
        )}

        {/* Not connected, but the deployment env is already reading live data. */}
        {state && !state.connected && state.envFallback.token && !showForm && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-[13px] leading-relaxed text-white/55">
              Live data is being read with the deployment's META_ACCESS_TOKEN
              {state.envFallback.adAccountId ? ` (act_${state.envFallback.adAccountId})` : ''}.
              Storing a connection here overrides it without a redeploy.
            </p>
            <SecondaryButton onClick={() => setShowForm(true)} disabled={!state.storageAvailable}>
              Store a connection instead
            </SecondaryButton>
          </div>
        )}

        {/* Not connected and no env fallback — the form is the whole point. */}
        {state && !state.connected && !state.envFallback.token && !state.storageAvailable && (
          <p className="max-w-xl text-[13px] leading-relaxed text-white/55">
            Supabase is not configured, so a connection cannot be stored from here. Set
            META_ACCESS_TOKEN in the deployment environment instead — this tab reads it
            automatically.
          </p>
        )}

        {/* The form. Open by default only when it is the only way in. */}
        {state &&
          !state.connected &&
          state.storageAvailable &&
          (showForm || !state.envFallback.token) && (
            <div className="space-y-3.5">
              <p className="max-w-xl text-[13px] leading-relaxed text-white/55">
                Generate a System User token in Business Manager → Business Settings → System Users
                with <span className="text-white/75">ads_read</span> and{' '}
                <span className="text-white/75">ads_management</span>. It is checked against Meta
                before anything is saved, and only its last four characters are ever shown again.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.6fr_1fr]">
                <label className="block">
                  <FieldLabel>Access token</FieldLabel>
                  <input
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="EAAG…"
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <FieldLabel>Ad account ID — optional</FieldLabel>
                  <input
                    type="text"
                    autoComplete="off"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    placeholder="1234567890"
                    className={inputClass}
                  />
                </label>
              </div>

              {/* The token can see several accounts — pick the one this platform reads. */}
              {accounts && (
                <div>
                  <FieldLabel>Which ad account should this read?</FieldLabel>
                  <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {accounts.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setChosenAccount(a.id)}
                        className={cn(
                          'rounded-lg border px-3 py-2.5 text-left transition-colors',
                          chosenAccount === a.id
                            ? 'border-primary/50 bg-primary/[0.08]'
                            : 'border-border bg-background/40 hover:border-primary/30',
                        )}
                      >
                        <span className="block truncate text-[13px] font-semibold text-white">
                          {a.name}
                        </span>
                        <span className="block font-mono text-[11.5px] text-white/45">
                          act_{a.id}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="text-[12.5px] leading-relaxed text-danger">{error}</p>}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !token.trim() || Boolean(accounts && !chosenAccount)}
                  onClick={() => void connect(accounts ? chosenAccount : undefined)}
                  className="brief-cta !mt-0 !px-4 !py-2.5 !text-[12.5px] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 size={13} className="animate-spin" />
                      Checking with Meta…
                    </span>
                  ) : accounts ? (
                    'Use this account'
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <KeyRound size={13} />
                      Connect
                    </span>
                  )}
                </button>
                {state.envFallback.token && (
                  <SecondaryButton
                    onClick={() => {
                      setShowForm(false)
                      setAccounts(null)
                      setError(null)
                    }}
                    disabled={busy}
                  >
                    Cancel
                  </SecondaryButton>
                )}
              </div>
            </div>
          )}
      </div>
    </Panel>
  )
}
