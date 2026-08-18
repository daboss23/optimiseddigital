'use client'

import { useCallback, useEffect, useState } from 'react'
import { Globe, Loader2 } from 'lucide-react'
import { Panel, PanelHeader } from '@/components/reactor/ui'
import { WebsiteLinkInput, WebsiteIntelligencePanel } from './WebsiteIntelligence'
import type { WebsiteSummary } from '@/lib/website-intelligence'

/**
 * Brand Intelligence surface. A fresh workspace shows the connect card; once a
 * site is analysed it flips to the full ATLAS profile (overview / brand /
 * colours / logo / audience / offers / messaging / proof / pages). One connected
 * website per workspace — disconnecting returns to the fresh state.
 */
export function BrandIntelligence() {
  const [reloadKey, setReloadKey] = useState(0)
  const [connected, setConnected] = useState<boolean | null>(null)
  // The scan run in this session. Without Supabase configured nothing is
  // persisted, so the Vault read comes back empty and the profile ATLAS just
  // built would never be shown at all. Holding it here keeps the connected
  // panel identical in demo mode — it just does not survive a reload.
  const [session, setSession] = useState<WebsiteSummary | null>(null)

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/vault/website', { cache: 'no-store' }).then((r) => r.json())
      setConnected(Boolean(res.success && res.website))
    } catch {
      setConnected(false)
    }
  }, [])

  useEffect(() => {
    check()
  }, [check, reloadKey])

  const onChanged = useCallback((summary?: WebsiteSummary | null) => {
    if (summary !== undefined) setSession(summary)
    setReloadKey((k) => k + 1)
  }, [])

  if (connected === null) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/30 px-4 py-6 text-sm text-white/45">
        <Loader2 size={15} className="animate-spin text-glow" /> Loading brand profile…
      </div>
    )
  }

  return (
    <>
      {!connected && !session && (
        <Panel>
          <PanelHeader
            icon={<Globe size={16} />}
            accent="cyan"
            title="Connect your website"
            subtitle="ATLAS reads your public site and builds your brand profile — offer, audience, positioning, voice, proof, colours and logo — in one pass."
          />
          <div className="p-5">
            <WebsiteLinkInput onChanged={onChanged} />
          </div>
        </Panel>
      )}
      <WebsiteIntelligencePanel
        reloadKey={reloadKey}
        onChanged={onChanged}
        sessionSummary={session}
      />
    </>
  )
}
