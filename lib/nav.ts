import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard,
  Database,
  Radar,
  Sparkles,
  BookOpen,
  Atom,
  BarChart3,
  Target,
  Boxes,
  Copy,
  Fingerprint,
} from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  system?: string
}

export const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Research Intelligence', href: '/research', icon: Radar, system: '02' },
  { label: 'Creative Intelligence', href: '/creative', icon: Sparkles, system: '03' },
  { label: 'Playbook', href: '/playbook', icon: BookOpen, system: '04' },
  { label: 'Campaign Reactor', href: '/campaign-reactor', icon: Atom, system: '05' },
  { label: 'Ad Library', href: '/ad-library', icon: Copy },
  { label: 'Meta Intelligence', href: '/meta', icon: BarChart3, system: '06' },
  { label: 'Recommendations', href: '/recommendations', icon: Target, system: '07' },
  { label: 'Agent Network', href: '/network', icon: Boxes, system: '08' },
  { label: 'Brand Intelligence', href: '/brand', icon: Fingerprint, system: '09' },
  // The Vault is the foundation everything is built on — it gets a dedicated
  // launcher pinned to the foot of the sidebar, so it is deliberately LAST.
  { label: 'Knowledge Vault', href: '/knowledge-vault', icon: Database, system: '01' },
]
