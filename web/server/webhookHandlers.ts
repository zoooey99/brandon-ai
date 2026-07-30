import Stripe from 'stripe';
import { stripe, getStripeWebhookSecret } from './stripeClient';
import { storage } from './storage';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const webhookSecret = getStripeWebhookSecret();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      throw new Error(`Webhook signature verification failed: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSessionCompleted(session);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentSucceeded(invoice);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentFailed(invoice);
        break;
      }
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  console.log('Checkout session completed:', session.id);

  // Get the customer and subscription info from the session
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;

  if (!customerId || !subscriptionId) {
    console.log('No customer or subscription in checkout session');
    return;
  }

  // Get user ID from session metadata or customer metadata
  const userId = session.metadata?.userId || session.client_reference_id;

  if (userId) {
    await storage.updateUserStripeInfo(userId, customerId, subscriptionId, 'active');
    console.log(`Updated user ${userId} with subscription ${subscriptionId}`);
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  console.log('Subscription updated:', subscription.id, 'Status:', subscription.status, 'cancel_at_period_end:', subscription.cancel_at_period_end);

  const customerId = subscription.customer as string;
  const subscriptionId = subscription.id;

  // If cancel_at_period_end is true, treat as canceled immediately
  // (Stripe won't fire subscription.deleted until the period actually ends)
  const status = subscription.cancel_at_period_end ? 'canceled' : subscription.status;

  // Try to find user by metadata first (more reliable), then fall back to customer ID
  let userId = subscription.metadata?.userId;
  let user = userId ? await storage.getUser(userId) : null;

  if (!user) {
    // Fall back to customer ID lookup
    user = await storage.getUserByStripeCustomerId(customerId);
  }

  if (user) {
    await storage.updateUserStripeInfo(user.id, customerId, subscriptionId, status);
    console.log(`Updated subscription status for user ${user.id} to ${status}`);
  } else {
    console.log(`No user found for subscription ${subscriptionId} (customerId: ${customerId}, metadata.userId: ${userId})`);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  console.log('Subscription deleted:', subscription.id);

  const customerId = subscription.customer as string;

  // Try to find user by metadata first (more reliable), then fall back to customer ID
  let userId = subscription.metadata?.userId;
  let user = userId ? await storage.getUser(userId) : null;

  if (!user) {
    // Fall back to customer ID lookup
    user = await storage.getUserByStripeCustomerId(customerId);
  }

  if (user) {
    await storage.updateUserStripeInfo(user.id, customerId, subscription.id, 'canceled');
    console.log(`Marked subscription as canceled for user ${user.id}`);
  } else {
    console.log(`No user found for deleted subscription ${subscription.id} (customerId: ${customerId}, metadata.userId: ${userId})`);
  }
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  console.log('Invoice payment succeeded:', invoice.id);

  const customerId = invoice.customer as string;
  // Access subscription from parent property (Stripe API 2025+)
  const subscriptionId = (invoice as any).parent?.subscription_details?.subscription as string | undefined
    || (invoice as any).subscription_details?.subscription as string | undefined;

  if (subscriptionId) {
    const user = await storage.getUserByStripeCustomerId(customerId);
    if (user) {
      await storage.updateUserStripeInfo(user.id, customerId, subscriptionId, 'active');
      console.log(`Confirmed active subscription for user ${user.id}`);
    }
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  console.log('Invoice payment failed:', invoice.id);

  const customerId = invoice.customer as string;
  // Access subscription from parent property (Stripe API 2025+)
  const subscriptionId = (invoice as any).parent?.subscription_details?.subscription as string | undefined
    || (invoice as any).subscription_details?.subscription as string | undefined;

  if (subscriptionId) {
    const user = await storage.getUserByStripeCustomerId(customerId);
    if (user) {
      await storage.updateUserStripeInfo(user.id, customerId, subscriptionId, 'past_due');
      console.log(`Marked subscription as past_due for user ${user.id}`);
    }
  }
}
