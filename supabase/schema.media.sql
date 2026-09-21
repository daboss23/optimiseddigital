-- Media generation ledger for the multi-model video "oven".
-- Tracks every render across providers (fal.ai gateway, Higgsfield) so
-- dashboards can report volume/spend and the agent can reuse past clips.

CREATE TABLE IF NOT EXISTS media_generations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  builder_id UUID REFERENCES builders(id) ON DELETE SET NULL,
  model_id TEXT NOT NULL,              -- registry id, e.g. 'seedance-2.0'
  provider TEXT NOT NULL,              -- 'fal' | 'higgsfield'
  mode TEXT NOT NULL,                  -- 'text-to-video' | 'image-to-video'
  prompt TEXT,
  image_url TEXT,                      -- source still for image-to-video
  request_id TEXT NOT NULL,            -- provider request/job id (poll key)
  status TEXT NOT NULL DEFAULT 'queued',
  video_url TEXT                       -- populated when the render completes
);

CREATE INDEX IF NOT EXISTS media_generations_request_id_idx ON media_generations (request_id);
CREATE INDEX IF NOT EXISTS media_generations_builder_idx ON media_generations (builder_id);
CREATE INDEX IF NOT EXISTS media_generations_created_idx ON media_generations (created_at DESC);
