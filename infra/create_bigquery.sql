-- The table the worker writes. api/src/saathi/analytics/bq.py creates the same table on first use;
-- this file is the reviewable copy. Replace PROJECT with the Google Cloud project id.
-- household_key is a salted hash of the household id. No names, quotes, or medicines are stored here.

CREATE SCHEMA IF NOT EXISTS `PROJECT.saathi` OPTIONS (location = 'US');

CREATE TABLE IF NOT EXISTS `PROJECT.saathi.daily_metrics` (
  household_key STRING NOT NULL,
  local_date DATE NOT NULL,
  response_gap_ms FLOAT64,
  speaking_rate_wpm FLOAT64,
  meals_reported INT64,
  meals_skipped INT64,
  family_contact BOOL,
  mood STRING,
  is_fasting BOOL,
  is_ill BOOL,
  session_count INT64,
  quality_ok BOOL,
  synthetic BOOL,
  updated_at TIMESTAMP
);

-- Retention, also run daily by the worker (/internal/retention): daily numbers older than 30 days.
-- DELETE FROM `PROJECT.saathi.daily_metrics` WHERE local_date < DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY);
