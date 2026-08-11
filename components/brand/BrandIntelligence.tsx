'use client'

import { useCallback, useEffect, useState } from 'react'
import { Globe, Loader2 } from 'lucide-react'
import { Panel, PanelHeader } from '@/components/reactor/ui'
import { WebsiteLinkInput, WebsiteIntelligencePanel } from './WebsiteIntelligence'

/**
 * Brand Intelligence surface. A fresh workspace shows the connect card; once a
 * site is analysed it flips to the full ATLAS profile (overview / brand /
 * colours / logo / audience / offers / messaging / proof / pages). One connected
 * website per workspace — disconnecting returns to the fresh state.
 */
export function BrandIntelligence() {
  const [reloadKey, setReloadKey] = useState(0)
  const [connected, setConnected] = useState<boolean | null>(null)

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

  const onChanged = useCallback(() => setReloadKey((k) => k + 1), [])

  if (connected === null) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/30 px-4 py-6 text-sm text-white/45">
        <Loader2 size={15} className="animate-spin text-glow" /> Loading brand profile…
      </div>
    )
  }

  return (
    <>
      {!connected && (
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
      <WebsiteIntelligencePanel reloadKey={reloadKey} onChanged={onChanged} />
    </>
  )
}
