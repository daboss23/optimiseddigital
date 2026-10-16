import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Builder, Framework, FrameworkInsert, FrameworkUpdate } from '@/types'

let anonClient: SupabaseClient | null = null
let adminClient: SupabaseClient | null = null

// NEXT_PUBLIC_SUPABASE_URL is inlined at build time. Also accept a runtime-read
// SUPABASE_URL so server code keeps working even if the public var wasn't present
// at build time (e.g. added to Vercel after the live build was created).
export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
}

function requireUrl(): string {
  const url = supabaseUrl()
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured')
  return url
}

// Accept either the classic anon key or the newer publishable key name.
function anonKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    ''
  )
}

// Accept either the classic service_role key or the newer secret key name.
function serviceKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
}

// Anon/publishable client. Lazily constructed on first use.
export function getSupabase(): SupabaseClient {
  if (!anonClient) {
    anonClient = createClient(requireUrl(), anonKey())
  }
  return anonClient
}

// Service-role client - privileged, server side only. Lazily constructed.
export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    const key = serviceKey()
    if (!key) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
    }
    adminClient = createClient(requireUrl(), key)
  }
  return adminClient
}

/* -------------------------------------------------------------------------- */
/* Accounts (tenants)                                                          */
/*                                                                             */
/* The table is `accounts` — renamed from `builders` by                        */
/* supabase/schema.tenancy.sql, which preserves every row, index and foreign   */
/* key. `getBuilder` reads one account BY ID — the session's own, resolved by    */
/* lib/account.ts. Listing and creating accounts used to live here behind an    */
/* unauthenticated /api/builders route that returned every brand on the        */
/* deployment; both were removed. Provisioning belongs to lib/account.ts.       */
/* -------------------------------------------------------------------------- */

export async function getBuilder(id: string): Promise<Builder> {
  const { data, error } = await getSupabaseAdmin()
    .from('accounts')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Builder
}

/* -------------------------------------------------------------------------- */
/* Creative outputs                                                            */
/* -------------------------------------------------------------------------- */

export interface CreativeOutputInsert {
  builder_id: string | null
  campaign_angle: string
  campaign_goal: string
  hooks: string[]
  body_copy: string[]
  ctas: string[]
  final_hook: string
  final_body: string
  final_cta: string
  image_prompt: string
  image_url_higgsfield: string | null
  image_url_openai: string | null
  copy_model: string
}

export async function saveCreativeOutput(output: CreativeOutputInsert) {
  const { data, error } = await getSupabaseAdmin()
    .from('creative_outputs')
    .insert([output])
    .select()
    .single()

  if (error) throw error
  return data
}


/* -------------------------------------------------------------------------- */
/* Frameworks library (P2)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One account's own frameworks, for managing them. Platform frameworks
 * (`builder_id IS NULL`) still reach generation through
 * `getFrameworksForBuilder`, but they are not a brand's to list or edit, and
 * another brand's are not a brand's to see at all — the old `'all'` scope
 * returned every row in the table.
 */
export async function listFrameworks(
  accountId: string,
  opts: { category?: string } = {},
): Promise<Framework[]> {
  const base = getSupabaseAdmin()
    .from('frameworks')
    .select('*')
    .eq('builder_id', accountId)
    .order('category', { ascending: true })
    .order('created_at', { ascending: true })

  const { data, error } = opts.category ? await base.eq('category', opts.category) : await base

  if (error) throw error
  return (data ?? []) as Framework[]
}

// For generation: returns global frameworks + builder-specific if builderId provided.
export async function getFrameworksForBuilder(builderId: string | null): Promise<Framework[]> {
  const base = getSupabaseAdmin()
    .from('frameworks')
    .select('*')
    .order('category', { ascending: true })
    .order('created_at', { ascending: true })

  const { data, error } = builderId
    ? await base.or(`builder_id.is.null,builder_id.eq.${builderId}`)
    : await base.is('builder_id', null)

  if (error) throw error
  return (data ?? []) as Framework[]
}

/** Create a framework owned by the session's account — never one the request names. */
export async function createFramework(input: FrameworkInsert, accountId: string): Promise<Framework> {
  const { data, error } = await getSupabaseAdmin()
    .from('frameworks')
    .insert([{ ...input, builder_id: accountId }])
    .select()
    .single()

  if (error) throw error
  return data as Framework
}

/**
 * Update one of the account's frameworks. The owner column cannot be moved by
 * an update, and an id the account does not own matches nothing.
 */
export async function updateFramework(
  id: string,
  updates: FrameworkUpdate,
  accountId: string,
): Promise<Framework> {
  const { builder_id: _ignored, ...patch } = updates
  void _ignored
  const { data, error } = await getSupabaseAdmin()
    .from('frameworks')
    .update(patch)
    .eq('id', id)
    .eq('builder_id', accountId)
    .select()
    .single()

  if (error) throw error
  return data as Framework
}

export async function deleteFramework(id: string, accountId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('frameworks')
    .delete()
    .eq('id', id)
    .eq('builder_id', accountId)

  if (error) throw error
}
