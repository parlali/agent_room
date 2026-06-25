PRAGMA writable_schema = ON;

UPDATE sqlite_schema
SET sql = replace(
    sql,
    'source IN (''subscription_included_credit'', ''included_credit_expiry'', ''stripe_topup'', ''hosted_openrouter_usage'', ''hosted_brave_usage'', ''manual_adjustment'')',
    'source IN (''subscription_included_credit'', ''included_credit_expiry'', ''stripe_topup'', ''hosted_openrouter_usage'', ''hosted_brave_usage'', ''hosted_browserbase_usage'', ''hosted_fetch_url_usage'', ''manual_adjustment'')'
)
WHERE type = 'table'
  AND name = 'hosted_billing_ledger_entry';

UPDATE sqlite_schema
SET sql = replace(
    sql,
    'provider IN (''openrouter'', ''brave'')',
    'provider IN (''openrouter'', ''brave'', ''browserbase'', ''fetch_url'')'
)
WHERE type = 'table'
  AND name = 'hosted_billing_reservation';

PRAGMA writable_schema = OFF;
