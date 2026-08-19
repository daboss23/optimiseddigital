# Optimised Digital — AI Creative System

> Standalone repository behind **`optimiseddigital.vercel.app`**, branched from
> the TPB Creative Reactor project to run as its own independent product and
> deployed from this repo's `main`. The system, brand memory and framework
> content below are inherited from that platform.

A brand-trained AI creative system for residential construction marketing.
It generates Meta ad copy and image creative from a short campaign brief, then
lets you compare models side by side and save the winner.

MVP demo built with Next.js 14, Tailwind CSS, Supabase, and the Anthropic,
OpenAI and Higgsfield APIs.

## What it does

1. Loads Summit Build Co brand intelligence (`brand/BRAND_MEMORY.md`) and
   creative frameworks (`skills/`) into the copy agents at runtime.
2. Takes a campaign **angle + goal** from a form.
3. Generates Meta ad copy with **two models in parallel** — Claude
   (`claude-sonnet-4-6`) and OpenAI (`gpt-5.5`) — for direct comparison.
4. Generates image creative with **two providers in parallel** — Higgsfield
   (motion) and OpenAI `gpt-image-1` (static) — shown side by side.
5. Renders a Facebook-style ad preview from the selected copy + image.
6. Saves the output to Supabase.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in real keys
npm run dev
```

Open http://localhost:3000.

### Environment variables

See `.env.example`. The app is built so it still compiles and the dashboard
renders without keys; each AI route returns a clean "not configured" error
until its key is set.

### Database

Run `supabase/schema.sql` in the Supabase SQL editor to create the
`creative_outputs` table.

## Deploy

Deploy to Vercel: import the repo, keep the **Root Directory** at the repo
root, add the environment variables above, and deploy.
