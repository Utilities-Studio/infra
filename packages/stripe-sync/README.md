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

## Requirements

- Bun runtime
- Stripe account with API key
- Supabase project (for pull and webhook commands)
