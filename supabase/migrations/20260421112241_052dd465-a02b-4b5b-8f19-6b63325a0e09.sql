-- Adaptive learning + multi-market storage for MIRO

-- 1. Predictions: every forecast snapshot we make
CREATE TABLE public.predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market TEXT NOT NULL,                 -- 'crypto' | 'nse' | 'bse' | 'forex'
  symbol TEXT NOT NULL,                 -- e.g. BTCUSDT, RELIANCE, EURUSD
  timeframe TEXT NOT NULL,              -- e.g. 1m, 10m, 1h
  spot_price NUMERIC NOT NULL,
  predicted_price NUMERIC NOT NULL,
  direction TEXT NOT NULL,              -- 'up' | 'down' | 'flat'
  horizon_seconds INTEGER NOT NULL,
  hybrid_confidence NUMERIC NOT NULL,
  weights JSONB NOT NULL,               -- {arima, hmm, entropy, hurst, llm}
  features JSONB,                       -- snapshot of physics features
  llm_bias NUMERIC,                     -- -1..1 from news LLM
  resolves_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_predictions_resolve ON public.predictions(resolves_at) WHERE resolves_at IS NOT NULL;
CREATE INDEX idx_predictions_symbol ON public.predictions(market, symbol, timeframe, created_at DESC);

ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Predictions are public read"  ON public.predictions FOR SELECT USING (true);
CREATE POLICY "Anyone can insert predictions" ON public.predictions FOR INSERT WITH CHECK (true);

-- 2. Outcomes: actual result once horizon elapses
CREATE TABLE public.prediction_outcomes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prediction_id UUID NOT NULL REFERENCES public.predictions(id) ON DELETE CASCADE UNIQUE,
  actual_price NUMERIC NOT NULL,
  actual_direction TEXT NOT NULL,
  direction_correct BOOLEAN NOT NULL,
  abs_error NUMERIC NOT NULL,
  pct_error NUMERIC NOT NULL,
  brier_score NUMERIC NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outcomes_pred ON public.prediction_outcomes(prediction_id);

ALTER TABLE public.prediction_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Outcomes are public read"   ON public.prediction_outcomes FOR SELECT USING (true);
CREATE POLICY "Anyone can insert outcomes" ON public.prediction_outcomes FOR INSERT WITH CHECK (true);

-- 3. Adaptive model weights, EMA-updated per (market, symbol, timeframe)
CREATE TABLE public.model_weights (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  arima_w NUMERIC NOT NULL DEFAULT 0.45,
  hmm_w NUMERIC NOT NULL DEFAULT 0.25,
  entropy_w NUMERIC NOT NULL DEFAULT 0.15,
  hurst_w NUMERIC NOT NULL DEFAULT 0.10,
  llm_w NUMERIC NOT NULL DEFAULT 0.05,
  samples INTEGER NOT NULL DEFAULT 0,
  recent_brier NUMERIC NOT NULL DEFAULT 0.25,
  recent_accuracy NUMERIC NOT NULL DEFAULT 0.5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market, symbol, timeframe)
);

ALTER TABLE public.model_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Weights are public read"     ON public.model_weights FOR SELECT USING (true);
CREATE POLICY "Anyone can upsert weights"   ON public.model_weights FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update weights"   ON public.model_weights FOR UPDATE USING (true);

-- 4. News + LLM sentiment cache (avoid re-running LLM for same article)
CREATE TABLE public.news_sentiment_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT,
  sentiment NUMERIC NOT NULL,           -- -1..1
  bias NUMERIC NOT NULL,                -- directional bias toward symbol
  rationale TEXT,
  published_at TIMESTAMPTZ,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market, symbol, url_hash)
);

CREATE INDEX idx_news_cache_lookup ON public.news_sentiment_cache(market, symbol, cached_at DESC);

ALTER TABLE public.news_sentiment_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "News cache public read"   ON public.news_sentiment_cache FOR SELECT USING (true);
CREATE POLICY "Anyone can insert news"   ON public.news_sentiment_cache FOR INSERT WITH CHECK (true);
