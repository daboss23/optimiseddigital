'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, X, Search, Bell, Atom, ChevronRight, LogOut } from 'lucide-react'
import { navItems } from '@/lib/nav'
import { BrandMark, useBrandIdentity } from '@/components/reactor/BrandMark'
import { cn } from '@/lib/utils'

export function Topbar() {
  const identity = useBrandIdentity()
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // The drawer is portaled to <body>, which only exists in the browser.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const current = navItems.find((n) => n.href === pathname)
  // The dashboard leads with the Live Intelligence badge alone — the brand mark
  // already names the product, so a "Reactor Dashboard" title is redundant.
  // Other pages keep their label for wayfinding.
  const heading = pathname === '/' ? '' : current?.label ?? ''

  // Route changes close the drawer — otherwise it stays over the page the user
  // just navigated to.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // While the drawer is up it owns the screen: the page behind must not scroll
  // (iOS in particular will happily scroll the body under a fixed overlay),
  // Escape must dismiss, and focus moves into the panel for keyboard users.
  useEffect(() => {
    if (!open) return
    const { body } = document
    const prevOverflow = body.style.overflow
    body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => {
      body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Sign out. The session cookies go; Mike's decision log stays, because
  // leaving for the day is not the same as handing the account to somebody
  // else — the login form is what clears his memory, and only when a
  // different operator signs in.
  const signOut = async () => {
    setOpen(false)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* the redirect below still takes them to the door */
    }
    router.replace('/login')
    router.refresh()
  }

  // Launch a new campaign from anywhere. On the reactor page the modal is
  // already mounted, so signal it directly; elsewhere, navigate in with the
  // ?modal=open flag the Workbench reads on arrival.
  const newCampaign = () => {
    setOpen(false)
    if (pathname === '/campaign-reactor') {
      window.dispatchEvent(new Event('open-reactor-modal'))
    } else {
      router.push('/campaign-reactor?modal=open')
    }
  }

  return (
    <header className="reactor-topbar sticky top-0 z-30">
      <div className="flex h-14 items-center gap-2 px-3 sm:h-16 sm:gap-4 sm:px-5 lg:px-8">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="topbar-control tap-target grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-white/70 lg:hidden"
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="reactor-mobile-nav"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>

        <Link href="/" className="shrink-0 lg:hidden" aria-label={`${identity.name} — Dashboard`}>
          <BrandMark size="sm" />
        </Link>

        <div className="hidden items-center gap-3 lg:flex">
          {current?.system && (
            <span className="font-mono text-[11px] tracking-widest text-glow/70">
              SYSTEM {current.system}
            </span>
          )}
          {heading && (
            <h1 className="font-display text-base font-semibold tracking-tight text-white">
              {heading}
            </h1>
          )}
          <span className="live-pill">
            <span className="live-pill__dot" />
            Live Intelligence
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
          <label className="topbar-search hidden w-64 xl:flex" aria-label="Search intelligence">
            <Search size={15} className="shrink-0 text-glow/70" />
            {/* Named and typed as search so no password manager mistakes it
                for a username field and drops the operator's login into it. */}
            <input
              type="search"
              name="intelligence-search"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              placeholder="Search intelligence…"
              spellCheck={false}
            />
            <kbd className="topbar-kbd ml-auto shrink-0">⌘K</kbd>
          </label>
          <button
            type="button"
            className="topbar-control tap-target relative hidden h-10 w-10 place-items-center rounded-xl border border-border text-white/60 hover:text-white sm:grid"
            aria-label="Alerts"
          >
            <Bell size={16} />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_8px_2px_rgba(34,211,238,0.7)] animate-pulse-glow" />
          </button>
          <button
            type="button"
            onClick={newCampaign}
            className="fire-btn fire-btn--sm tap-target inline-flex items-center gap-2 font-display font-bold uppercase tracking-wide text-white"
          >
            <Atom size={15} />
            <span className="hidden sm:inline">New Creative Campaign</span>
            <span className="sm:hidden">New</span>
          </button>
          <div className="topbar-avatar hidden h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-cyan text-xs font-bold text-white sm:grid">
            {identity.initials}
          </div>
          <button
            type="button"
            onClick={signOut}
            className="topbar-control tap-target hidden h-10 w-10 place-items-center rounded-xl border border-border text-white/55 hover:text-white sm:grid"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* Mobile navigation — a real drawer: dimmed backdrop, its own scroll,
          safe-area padding at the foot, and the page behind locked.

          Portaled to <body> deliberately. The topbar carries a backdrop-filter,
          and a filtered element becomes the containing block for any
          `position: fixed` descendant — rendered inline, the drawer was boxed
          into the 56px-tall header and painted underneath the page. */}
      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="mobile-nav-scrim absolute inset-0"
          />
          <div
            id="reactor-mobile-nav"
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="mobile-nav-panel absolute inset-y-0 left-0 flex w-[86vw] max-w-[320px] flex-col outline-none"
          >
            <div className="flex items-center justify-between px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
              <BrandMark size="sm" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="topbar-control tap-target grid h-10 w-10 place-items-center rounded-xl border border-border text-white/70"
                aria-label="Close navigation"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 pb-4">
              {navItems.map((item) => {
                const active = pathname === item.href
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'reactor-nav-item tap-target flex items-center gap-3 rounded-xl px-3 py-3 text-sm',
                      active ? 'is-active text-white' : 'text-white/65',
                    )}
                  >
                    <span className="nav-icon-chip grid h-8 w-8 shrink-0 place-items-center rounded-lg">
                      <Icon size={16} className={active ? 'text-glow' : 'text-white/45'} />
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

            <div className="border-t border-border/60 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              <div className="sysstatus-module flex items-center gap-2.5 px-3 py-2.5">
                <span className="dot-live h-2 w-2 shrink-0 rounded-full animate-pulse-glow" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-white/85">System Status</p>
                  <p className="truncate text-[10px] text-emerald/80">All Systems Operational</p>
                </div>
                <ChevronRight size={14} className="shrink-0 text-emerald/60" />
              </div>

              {/* The phone has no topbar avatar row, so sign-out lives here or
                  nowhere. */}
              <button
                type="button"
                onClick={signOut}
                className="tap-target mt-2 flex w-full items-center gap-3 rounded-xl border border-border px-3 py-3 text-sm font-medium text-white/65"
              >
                <span className="nav-icon-chip grid h-8 w-8 shrink-0 place-items-center rounded-lg">
                  <LogOut size={16} className="text-white/45" />
                </span>
                Sign out
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </header>
  )
}
