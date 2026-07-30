"""
Stripe webhook endpoint for Brandon Backend.
Handles subscription status updates from Stripe.
"""

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
import stripe
import logging

from app.config import settings
from app.db.supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """
    Handle Stripe webhook events.

    Verifies webhook signature and processes subscription events
    to keep local database in sync with Stripe.

    Events handled:
    - customer.subscription.created
    - customer.subscription.updated
    - customer.subscription.deleted
    - invoice.payment_failed
    """
    # Get the raw body
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if not sig_header:
        logger.warning("Stripe webhook received without signature")
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    if not settings.stripe_webhook_secret:
        logger.error("STRIPE_WEBHOOK_SECRET not configured")
        raise HTTPException(status_code=500, detail="Webhook secret not configured")

    # Verify signature
    try:
        event = stripe.Webhook.construct_event(
            payload,
            sig_header,
            settings.stripe_webhook_secret
        )
    except ValueError as e:
        logger.error(f"Invalid webhook payload: {e}")
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError as e:
        logger.error(f"Invalid webhook signature: {e}")
        raise HTTPException(status_code=400, detail="Invalid signature")

    event_type = event["type"]
    logger.info(f"Stripe webhook received: {event_type}")

    # Handle subscription events
    if event_type in [
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted"
    ]:
        await handle_subscription_event(event)
    elif event_type == "invoice.payment_failed":
        await handle_payment_failed(event)
    else:
        logger.info(f"Unhandled event type: {event_type}")

    return JSONResponse(content={"received": True})


async def handle_subscription_event(event: dict):
    """
    Handle subscription lifecycle events.
    Updates user's subscription_status in the database.
    """
    subscription = event["data"]["object"]
    subscription_id = subscription["id"]
    status = subscription["status"]  # active, trialing, past_due, canceled, unpaid, etc.
    customer_id = subscription["customer"]

    logger.info(f"Subscription {subscription_id} status changed to: {status}")

    try:
        supabase = get_supabase()

        # Find user by stripe_subscription_id
        result = supabase.table("users") \
            .select("id") \
            .eq("stripe_subscription_id", subscription_id) \
            .execute()

        if not result.data:
            # Try finding by stripe_customer_id if we store that
            logger.warning(f"No user found with subscription_id: {subscription_id}")
            return

        user_id = result.data[0]["id"]

        # Update subscription status
        update_result = supabase.table("users") \
            .update({"subscription_status": status}) \
            .eq("id", user_id) \
            .execute()

        if update_result.data:
            logger.info(f"Updated user {user_id} subscription_status to: {status}")
        else:
            logger.error(f"Failed to update user {user_id}")

    except Exception as e:
        logger.error(f"Error handling subscription event: {e}", exc_info=True)


async def handle_payment_failed(event: dict):
    """
    Handle failed payment events.
    Could trigger notifications or update status.
    """
    invoice = event["data"]["object"]
    subscription_id = invoice.get("subscription")
    customer_id = invoice["customer"]

    logger.warning(f"Payment failed for subscription: {subscription_id}, customer: {customer_id}")

    # The subscription.updated event will handle status change to past_due
    # This handler can be used for additional actions like notifications
