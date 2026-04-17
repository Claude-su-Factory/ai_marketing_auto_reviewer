import { Router } from "express";
import Stripe from "stripe";
import type { BillingService } from "../billing.js";

export function createStripeWebhookRouter(
  stripe: Stripe,
  webhookSecret: string,
  billing: BillingService
) {
  const router = Router();

  router.post("/stripe/webhook", (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (e) {
      console.error("[Webhook] Signature verification failed:", e);
      res.status(400).json({ error: "Webhook signature failed" });
      return;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const licenseId = session.metadata?.licenseId;
        if (licenseId) {
          const amount = (session.amount_total ?? 0) / 100;
          billing.addBalance(licenseId, amount);
          billing.activateLicense(licenseId);

          // Save payment method for future auto-recharge
          if (session.payment_intent) {
            const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
            stripe.paymentIntents.retrieve(piId).then((pi) => {
              if (pi.payment_method) {
                const pmId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method.id;
                billing.setPaymentMethod(licenseId, pmId);
              }
            }).catch(() => {});
          }
          console.log(`[Webhook] Checkout completed: license ${licenseId}, +$${amount}`);
        }
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        // Only process auto-recharge (not initial checkout — handled above)
        if (pi.metadata?.type === "auto_recharge" && pi.metadata?.licenseId) {
          const amount = pi.amount / 100;
          billing.addBalance(pi.metadata.licenseId, amount);
          console.log(`[Webhook] Auto-recharge: license ${pi.metadata.licenseId}, +$${amount}`);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        if (pi.metadata?.licenseId) {
          billing.suspendLicense(pi.metadata.licenseId);
          console.log(`[Webhook] Payment failed: license ${pi.metadata.licenseId} suspended`);
        }
        break;
      }
    }

    res.json({ received: true });
  });

  return router;
}
