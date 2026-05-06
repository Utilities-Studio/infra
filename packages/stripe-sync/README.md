# @utilities-studio/stripe-sync

Sync Stripe products, prices, and webhooks. Push config to Stripe, pull data to Supabase.

## Usage

```bash
# Push products/prices from config to Stripe
bunx @utilities-studio/stripe-sync push ./scripts/stripe-config.json

# Dry run (show what would change)
bunx @utilities-studio/stripe-sync push ./scripts/stripe-config.json --dry

# Pull products/prices from Stripe to Supabase
bunx @utilities-studio/stripe-sync pull

# Force a pull target when auto-detection is not desired
bunx @utilities-studio/stripe-sync pull --target=stripe-sync-engine

# Setup/update webhook endpoint
bunx @utilities-studio/stripe-sync webhook ./scripts/stripe-config.json
```

## Config Format

Create `scripts/stripe-config.json` in your project:

```json
{
  "products": [
    {
      "name": "Free",
      "description": "Get started",
      "features": ["3 seats", "Basic support"],
      "metadata": { "seats": "3" },
      "prices": []
    },
    {
      "name": "Pro",
      "description": "Most popular",
      "features": ["Unlimited seats", "Priority support", "Analytics"],
      "metadata": { "seats": "-1", "analytics": "true" },
      "prices": [
        { "amount": 2900, "interval": "month", "lookupKey": "pro_monthly" },
        { "amount": 27800, "interval": "year", "lookupKey": "pro_yearly" }
      ]
    },
    {
      "name": "10 Credits",
      "description": "10 credits",
      "metadata": { "credits": "10" },
      "prices": [
        { "amount": 1000, "lookupKey": "credits_10", "oneTime": true }
      ]
    }
  ],
  "webhookName": "My App Webhooks",
  "webhookEvents": [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
    "product.created",
    "product.updated",
    "price.created",
    "price.updated"
  ]
}
```

## Environment Variables

| Variable | Required for | Description |
|----------|-------------|-------------|
| `STRIPE_SECRET_KEY` | all commands | Stripe API key |
| `SUPABASE_URL` | pull, webhook | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | pull | Supabase admin key |
| `SUPABASE_DB_URL` | pull | Direct Postgres URL for the `stripe-sync-engine` target |
| `STRIPE_SYNC_TARGET` | pull | Optional target: `auto`, `public`, or `stripe-sync-engine` |

## Requirements

- Bun runtime
- Stripe account with API key
- Supabase project (for pull and webhook commands)

## Pull Targets

`pull` defaults to `auto`. It first uses legacy public tables
(`public.stripe_products` and `public.stripe_prices`) when they exist. If those
tables are not present, it falls back to Supabase's Stripe sync engine mirror
tables (`stripe.products` and `stripe.prices`). For the sync engine target, the
package uses `SUPABASE_DB_URL` when available so it can run sync-engine
migrations and write through direct Postgres. Without `SUPABASE_DB_URL`, it
falls back to Supabase REST, and the `stripe` schema must be exposed in
Supabase API settings with writable grants for the service role.
