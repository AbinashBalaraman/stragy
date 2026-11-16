CREATE TABLE IF NOT EXISTS ai_provider_settings (
  id text PRIMARY KEY DEFAULT 'default',
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
