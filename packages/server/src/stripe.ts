import Stripe from "stripe";
import { requireStripeConfig } from "@ad-ai/core/config/helpers.js";

/**
 * Throws if [billing.stripe] is not configured. Callers that don't gate on
 * `getConfig().billing?.stripe` rely on the invariant that licenses with
 * stripe_customer_id only exist when billing config is present (enforced by
 * admin.ts create-license).
 */
export function createStripeClient(): Stripe {
  return new Stripe(requireStripeConfig().secret_key);
}

export async function createStripeCustomer(stripe: Stripe, email: string, licenseKey: string): Promise<string> {
  const customer = await stripe.customers.create({ email, metadata: { licenseKey } });
  return customer.id;
}

export async function createCheckoutSession(
  stripe: Stripe, customerId: string, amount: number, licenseId: string,
  successUrl = "https://ad-ai.com/success", cancelUrl = "https://ad-ai.com/cancel"
): Promise<string> {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    payment_intent_data: { setup_future_usage: "off_session", metadata: { licenseId, type: "initial_charge" } },
    line_items: [{ price_data: { currency: "usd", product_data: { name: "AD-AI Credits" }, unit_amount: Math.round(amount * 100) }, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return session.url!;
}

export async function triggerAutoRecharge(
  stripe: Stripe, customerId: string, paymentMethodId: string, amount: number, licenseId: string
): Promise<void> {
  await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: "usd",
    customer: customerId,
    payment_method: paymentMethodId,
    off_session: true,
    confirm: true,
    metadata: { licenseId, type: "auto_recharge" },
  });
}
