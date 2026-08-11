'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { navItems } from '@/lib/nav'
import { ReactorLogo } from '@/components/reactor/ReactorLogo'
import { cn } from '@/lib/utils'

export function Sidebar() {
  const pathname = usePathname()

  // The Knowledge Vault gets a dedicated launcher anchored to the foot of the
  // sidebar — "the foundation everything else is built on" sits at the base.
  const vaultItem = navItems.find((i) => i.href === '/knowledge-vault')
  const topItems = navItems.filter((i) => i.href !== '/knowledge-vault')

  return (
    <aside className="reactor-sidebar hidden w-[268px] shrink-0 flex-col lg:flex">
      <div className="reactor-brand px-5 py-5">
        <Link href="/" className="block" aria-label="TPB Creative Reactor — Dashboard">
          <ReactorLogo />
        </Link>
      </div>

      <nav className="reactor-nav flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
        {topItems.map((item) => {
          const active = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'reactor-nav-item group relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-all',
                active ? 'is-active text-white' : 'text-white/55 hover:text-white',
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-glow shadow-[0_0_12px_2px_rgba(94,168,255,0.7)]" />
              )}
              <span className="nav-icon-chip grid h-7 w-7 shrink-0 place-items-center rounded-lg">
                <Icon
                  size={15}
                  className={cn(active ? 'text-glow' : 'text-white/45 group-hover:text-glow/80')}
                />
              </span>
              <span className="flex-1 truncate font-medium">{item.label}</span>
              {item.system && (
                <span className="font-mono text-[10px] tracking-widest text-white/25">
                  {item.system}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="space-y-2 border-t border-border/60 px-3 py-3">
        {vaultItem && (
          <Link
            href={vaultItem.href}
            aria-label="Open the Knowledge Vault"
            className={cn(
              'vault-launcher group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-3 transition-all',
              pathname === vaultItem.href ? 'is-active' : '',
            )}
          >
            <span className="vault-launcher-seal grid h-9 w-9 shrink-0 place-items-center rounded-lg">
              <vaultItem.icon size={17} className="text-glow" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-bold tracking-wide text-white">
                {vaultItem.label}
              </p>
              <p className="truncate text-[10px] uppercase tracking-[0.18em] text-glow/60">
                Timeless Knowledge
              </p>
            </div>
            <ChevronRight size={14} className="shrink-0 text-glow/50 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
    </aside>
  )
}
