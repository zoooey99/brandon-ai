"""
Admin routes for Brandon Backend.
Server-rendered admin UI using Jinja2 templates.
"""

from fastapi import APIRouter, Request, Form, Query
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Optional, Any
import logging
import asyncio
import time
from nanoid import generate as nanoid

# Default timezone if not set
DEFAULT_TIMEZONE = "America/Chicago"

ALLOWED_TIMEZONES = {
    "America/New_York": "Eastern",
    "America/Chicago": "Central",
    "America/Denver": "Mountain",
    "America/Los_Angeles": "Pacific",
}


def get_admin_tz(request: Request) -> ZoneInfo:
    """Read timezone from the brandon_admin_tz cookie, default to Central."""
    tz_name = request.cookies.get("brandon_admin_tz", DEFAULT_TIMEZONE)
    if tz_name not in ALLOWED_TIMEZONES:
        tz_name = DEFAULT_TIMEZONE
    return ZoneInfo(tz_name)


def _tz_label(tz: ZoneInfo) -> str:
    """Return short label like 'Central' for template display."""
    return ALLOWED_TIMEZONES.get(str(tz), "Central")


import stripe

from app.admin.auth import (
    is_authenticated,
    check_password,
    set_auth_cookie,
    clear_auth_cookie
)
from app.db.supabase_client import get_supabase
from app.db.queries import get_workout_adherence
from app.services.scheduler import schedule_user_message
from app.services.mac_client import MacServerClient
from app.services.helicone import get_usage_stats
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin")

# Setup templates
templates_path = Path(__file__).parent / "templates"
templates = Jinja2Templates(directory=str(templates_path))


# =============================================================================
# TTL Cache for expensive API calls (Stripe)
# =============================================================================

_cache: dict[str, dict[str, Any]] = {}
CACHE_TTL_SECONDS = 300  # 5 minutes


def _cache_get(key: str) -> Any | None:
    entry = _cache.get(key)
    if entry and time.time() - entry["ts"] < CACHE_TTL_SECONDS:
        return entry["value"]
    return None


def _cache_set(key: str, value: Any):
    _cache[key] = {"value": value, "ts": time.time()}


# =============================================================================
# Auth Routes
# =============================================================================

@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, error: Optional[str] = None):
    """Show login page."""
    if is_authenticated(request):
        return RedirectResponse(url="/admin/", status_code=303)

    return templates.TemplateResponse("login.html", {
        "request": request,
        "authenticated": False,
        "error": error
    })


@router.post("/login")
async def login(request: Request, password: str = Form(...)):
    """Handle login form submission."""
    if check_password(password):
        response = RedirectResponse(url="/admin/", status_code=303)
        return set_auth_cookie(response)

    return templates.TemplateResponse("login.html", {
        "request": request,
        "authenticated": False,
        "error": "Invalid password"
    })


@router.get("/logout")
async def logout():
    """Log out and clear session."""
    response = RedirectResponse(url="/admin/login", status_code=303)
    return clear_auth_cookie(response)


@router.post("/set-timezone")
async def set_timezone(request: Request, timezone: str = Form(...)):
    """Set the admin timezone display preference cookie."""
    if timezone not in ALLOWED_TIMEZONES:
        timezone = DEFAULT_TIMEZONE
    referer = request.headers.get("referer", "/admin/")
    response = RedirectResponse(url=referer, status_code=303)
    response.set_cookie("brandon_admin_tz", timezone, max_age=60 * 60 * 24 * 365)
    return response


# =============================================================================
# Dashboard Helper Functions
# =============================================================================

async def get_signups_by_day(all_users: list, days: int = 30) -> dict:
    """
    Get daily signups with Stripe vs Promo code breakdown.
    Accepts pre-fetched users list to avoid redundant queries.
    """
    supabase = get_supabase()
    result = {"labels": [], "stripe": [], "promo": []}

    try:
        end_date = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        start_date = end_date - timedelta(days=days)
        start_iso = start_date.isoformat()

        # Filter pre-fetched users to date range
        users_in_range = [
            u for u in all_users
            if u.get("created_at", "") >= start_iso
        ]

        # Get promo redemptions — filtered by date range
        promo_users = supabase.table("promo_redemptions").select("user_id").gte(
            "created_at", start_iso
        ).execute()
        promo_user_ids = set(r.get("user_id") for r in (promo_users.data or []))

        daily_stripe = {}
        daily_promo = {}

        for user in users_in_range:
            created = user.get("created_at", "")
            if created:
                day = created.split("T")[0]
                if user.get("id") in promo_user_ids:
                    daily_promo[day] = daily_promo.get(day, 0) + 1
                else:
                    daily_stripe[day] = daily_stripe.get(day, 0) + 1

        for i in range(days):
            date = (start_date + timedelta(days=i+1)).strftime("%Y-%m-%d")
            result["labels"].append(date)
            result["stripe"].append(daily_stripe.get(date, 0))
            result["promo"].append(daily_promo.get(date, 0))

    except Exception as e:
        logger.error(f"Error getting signups by day: {e}")

    return result


async def get_mrr_from_stripe(exclude_customer_ids: set = None) -> dict:
    """
    Calculate MRR from Stripe subscriptions with trial breakdown.
    Results are cached for 5 minutes since Stripe data changes infrequently.
    Also caches the subscription-to-interval mapping for other helpers.
    Excludes subscriptions belonging to test user customer IDs.
    """
    cache_key = "mrr_data" if not exclude_customer_ids else "mrr_data_filtered"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    result = {
        "mrr": 0,
        "potential_mrr": 0,
        "monthly_count": 0,
        "yearly_count": 0,
        "no_card_count": 0,
        "currency": "usd",
        "trialing": {
            "count": 0,
            "monthly_count": 0,
            "yearly_count": 0,
            "mrr_value": 0,
            "by_day": {},
            "subscribers": []
        }
    }

    if not settings.stripe_secret_key:
        logger.warning("STRIPE_SECRET_KEY not configured, skipping MRR calculation")
        result["stripe_status"] = "not_configured"
        return result

    try:
        stripe.api_key = settings.stripe_secret_key
        now = datetime.utcnow()

        # Build a sub_id -> interval map while iterating (reused by other helpers)
        sub_interval_map = {}

        # Cache customer payment method status to avoid redundant lookups
        customer_has_payment = {}

        def _has_payment_method(sub) -> bool:
            """Check if a subscription has a payment method (on sub or customer)."""
            if sub.get("default_payment_method"):
                return True
            cust_id = sub.get("customer")
            if cust_id not in customer_has_payment:
                cust = stripe.Customer.retrieve(cust_id, expand=["invoice_settings.default_payment_method"])
                has_pm = bool(cust.get("invoice_settings", {}).get("default_payment_method"))
                customer_has_payment[cust_id] = has_pm
            return customer_has_payment[cust_id]

        # Get active subscriptions
        active_subs = stripe.Subscription.list(status="active", limit=100)
        for sub in active_subs.auto_paging_iter():
            # Skip test user subscriptions
            if exclude_customer_ids and sub.get("customer") in exclude_customer_ids:
                sub_interval_map[sub["id"]] = sub.get("items", {}).get("data", [{}])[0].get("price", {}).get("recurring", {}).get("interval", "month") if sub.get("items", {}).get("data") else "month"
                continue
            items_data = sub["items"]["data"] if sub.get("items") else []
            if items_data:
                item = items_data[0]
                price = item["price"]
                amount = price.get("unit_amount") or 0
                interval = price.get("recurring", {}).get("interval", "month")
                sub_interval_map[sub["id"]] = interval

                # Skip subscriptions with no payment method (e.g. promo codes with no card required)
                if not _has_payment_method(sub):
                    result["no_card_count"] = result.get("no_card_count", 0) + 1
                    continue

                if interval == "year":
                    result["yearly_count"] += 1
                    result["mrr"] += amount / 12
                else:
                    result["monthly_count"] += 1
                    result["mrr"] += amount

        # Get trialing subscriptions
        trialing_subs = stripe.Subscription.list(status="trialing", limit=100)
        for sub in trialing_subs.auto_paging_iter():
            # Skip test user subscriptions
            if exclude_customer_ids and sub.get("customer") in exclude_customer_ids:
                sub_interval_map[sub["id"]] = sub.get("items", {}).get("data", [{}])[0].get("price", {}).get("recurring", {}).get("interval", "month") if sub.get("items", {}).get("data") else "month"
                continue
            items_data = sub["items"]["data"] if sub.get("items") else []
            if items_data:
                item = items_data[0]
                price = item["price"]
                amount = price.get("unit_amount") or 0
                interval = price.get("recurring", {}).get("interval", "month")
                sub_interval_map[sub["id"]] = interval

                result["trialing"]["count"] += 1

                if interval == "year":
                    result["trialing"]["yearly_count"] += 1
                    result["trialing"]["mrr_value"] += amount / 12
                else:
                    result["trialing"]["monthly_count"] += 1
                    result["trialing"]["mrr_value"] += amount

                trial_start = datetime.fromtimestamp(sub["trial_start"]) if sub.get("trial_start") else None
                trial_end = datetime.fromtimestamp(sub["trial_end"]) if sub.get("trial_end") else None

                if trial_start:
                    days_into_trial = max(1, (now - trial_start).days + 1)
                    result["trialing"]["by_day"][days_into_trial] = \
                        result["trialing"]["by_day"].get(days_into_trial, 0) + 1

                    if len(result["trialing"]["subscribers"]) < 20:
                        days_remaining = (trial_end - now).days if trial_end else 0
                        result["trialing"]["subscribers"].append({
                            "plan": "yearly" if interval == "year" else "monthly",
                            "day": days_into_trial,
                            "days_remaining": max(0, days_remaining),
                            "amount": amount / 100
                        })

        # Get cancelled subscriptions too (for cancellations helper + trial expiry detection)
        cancelled_subs = stripe.Subscription.list(status="canceled", limit=100)
        trial_expired_sub_ids = set()
        for sub in cancelled_subs.auto_paging_iter():
            items_data = sub["items"]["data"] if sub.get("items") else []
            if items_data:
                interval = items_data[0]["price"].get("recurring", {}).get("interval", "month")
                sub_interval_map[sub["id"]] = interval
            if sub.get("trial_end") and sub.get("canceled_at"):
                if sub["canceled_at"] <= sub["trial_end"]:
                    trial_expired_sub_ids.add(sub["id"])

        result["mrr"] = round(result["mrr"] / 100, 2)
        result["trialing"]["mrr_value"] = round(result["trialing"]["mrr_value"] / 100, 2)
        result["potential_mrr"] = round(result["mrr"] + result["trialing"]["mrr_value"], 2)
        result["stripe_status"] = "connected"

        logger.info(f"MRR: ${result['mrr']}, Trialing: {result['trialing']['count']} (potential +${result['trialing']['mrr_value']}), No-card active: {result['no_card_count']}")

        # Cache MRR data, interval map, and trial expired sub IDs
        _cache_set(cache_key, result)
        _cache_set("sub_interval_map", sub_interval_map)
        _cache_set("trial_expired_sub_ids", trial_expired_sub_ids)

    except Exception as e:
        logger.error(f"Error calculating MRR from Stripe: {e}")
        result["stripe_status"] = f"error: {str(e)[:50]}"

    return result


async def get_engagement_breakdown(all_users: list, days: int = 7) -> dict:
    """
    Get engagement breakdown for users in the last N days.
    Uses pre-fetched users list and fetches only distinct user_ids from messages.
    """
    supabase = get_supabase()
    result = {
        "messaged": 0,
        "worked_out": 0,
        "both": 0,
        "total": 0
    }

    try:
        cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()

        existing_user_ids = set(u.get("id") for u in all_users)
        result["total"] = len(existing_user_ids)

        if not existing_user_ids:
            return result

        # Fetch distinct user_ids who messaged (deduplicated at DB level via limit)
        messages = supabase.table("messages").select("user_id").eq(
            "direction", "inbound"
        ).gte("created_at", cutoff).execute()

        messaged_users = set(
            m.get("user_id") for m in (messages.data or [])
            if m.get("user_id") in existing_user_ids
        )

        # Get users who completed workouts in the period
        workouts = supabase.table("workout_sessions").select("user_id").eq(
            "status", "completed"
        ).gte("workout_date", cutoff).execute()

        worked_out_users = set(
            w.get("user_id") for w in (workouts.data or [])
            if w.get("user_id") in existing_user_ids
        )

        both_users = messaged_users & worked_out_users
        result["messaged"] = len(messaged_users)
        result["worked_out"] = len(worked_out_users)
        result["both"] = len(both_users)

        logger.info(f"Engagement (7d): {result['messaged']} messaged, {result['worked_out']} worked out, {result['both']} both")

    except Exception as e:
        logger.error(f"Error getting engagement breakdown: {e}")

    return result


def _classify_users(users: list, profile_ids: set, plan_ids: set, messaged_ids: set,
                     ever_workout_ids: set, recent_msg_ids: set, recent_workout_ids: set,
                     trial_expired_sub_ids: set) -> dict:
    """Classify a list of users into lifecycle stages. Pure Python, no DB calls."""
    result = {
        "onboarding": {"count": 0},
        "stuck_in_activation": {"count": 0},
        "trialing": {"count": 0, "completed_first_workout": 0, "completed_pct": 0, "at_risk": 0, "at_risk_pct": 0},
        "expired_trial": {"count": 0},
        "active": {"count": 0, "completed_first_workout": 0, "completed_pct": 0, "at_risk": 0, "at_risk_pct": 0},
        "churned": {"count": 0},
        "total": 0,
    }

    trialing_ids = []
    active_ids = []

    for user in users:
        uid = user.get("id")
        sub_status = user.get("subscription_status")
        has_plan_and_msg = uid in plan_ids and uid in messaged_ids

        if sub_status in ("canceled", "cancelled"):
            stripe_sub_id = user.get("stripe_subscription_id")
            if stripe_sub_id and stripe_sub_id in trial_expired_sub_ids:
                result["expired_trial"]["count"] += 1
            else:
                result["churned"]["count"] += 1
        elif sub_status == "trialing":
            if has_plan_and_msg:
                result["trialing"]["count"] += 1
                trialing_ids.append(uid)
            else:
                result["stuck_in_activation"]["count"] += 1
        elif sub_status == "active":
            if has_plan_and_msg:
                result["active"]["count"] += 1
                active_ids.append(uid)
            else:
                result["stuck_in_activation"]["count"] += 1
        else:
            result["onboarding"]["count"] += 1

    # Sub-metrics for Trialing
    for uid in trialing_ids:
        if uid in ever_workout_ids:
            result["trialing"]["completed_first_workout"] += 1
        if uid not in recent_msg_ids and uid not in recent_workout_ids:
            result["trialing"]["at_risk"] += 1
    tc = result["trialing"]["count"]
    if tc > 0:
        result["trialing"]["completed_pct"] = round(result["trialing"]["completed_first_workout"] / tc * 100)
        result["trialing"]["at_risk_pct"] = round(result["trialing"]["at_risk"] / tc * 100)

    # Sub-metrics for Active
    for uid in active_ids:
        if uid in ever_workout_ids:
            result["active"]["completed_first_workout"] += 1
        if uid not in recent_msg_ids and uid not in recent_workout_ids:
            result["active"]["at_risk"] += 1
    ac = result["active"]["count"]
    if ac > 0:
        result["active"]["completed_pct"] = round(result["active"]["completed_first_workout"] / ac * 100)
        result["active"]["at_risk_pct"] = round(result["active"]["at_risk"] / ac * 100)

    result["total"] = sum(
        result[stage]["count"]
        for stage in ("onboarding", "stuck_in_activation", "trialing", "expired_trial", "active", "churned")
    )
    return result


async def get_user_funnel(all_users: list) -> dict:
    """
    Classify users into lifecycle stages for 3 time windows: 24h, 7d, lifetime.
    Fetches lookup data once, classifies 3 user subsets.
    """
    supabase = get_supabase()

    empty = {
        "onboarding": {"count": 0},
        "stuck_in_activation": {"count": 0},
        "trialing": {"count": 0, "completed_first_workout": 0, "completed_pct": 0, "at_risk": 0, "at_risk_pct": 0},
        "expired_trial": {"count": 0},
        "active": {"count": 0, "completed_first_workout": 0, "completed_pct": 0, "at_risk": 0, "at_risk_pct": 0},
        "churned": {"count": 0},
        "total": 0,
    }
    result = {"24h": dict(empty), "7d": dict(empty), "lifetime": dict(empty)}

    try:
        all_user_ids = set(u.get("id") for u in all_users)
        if not all_user_ids:
            return result

        # --- Fetch lookup sets once ---
        profiles_result = supabase.table("profiles").select("user_id").execute()
        profile_ids = set(p["user_id"] for p in (profiles_result.data or []) if p.get("user_id") in all_user_ids)

        plans_result = supabase.table("workout_plans").select("user_id").eq("status", "active").execute()
        plan_ids = set(p["user_id"] for p in (plans_result.data or []) if p.get("user_id") in all_user_ids)

        msgs_result = supabase.table("messages").select("user_id").eq("direction", "inbound").execute()
        messaged_ids = set(m["user_id"] for m in (msgs_result.data or []) if m.get("user_id") in all_user_ids)

        workouts_result = supabase.table("workout_sessions").select("user_id").eq("status", "completed").execute()
        ever_workout_ids = set(w["user_id"] for w in (workouts_result.data or []) if w.get("user_id") in all_user_ids)

        cutoff_7d = (datetime.utcnow() - timedelta(days=7)).isoformat()
        recent_msgs = supabase.table("messages").select("user_id").eq("direction", "inbound").gte("created_at", cutoff_7d).execute()
        recent_msg_ids = set(m["user_id"] for m in (recent_msgs.data or []) if m.get("user_id") in all_user_ids)

        recent_workouts = supabase.table("workout_sessions").select("user_id").eq("status", "completed").gte("workout_date", cutoff_7d).execute()
        recent_workout_ids = set(w["user_id"] for w in (recent_workouts.data or []) if w.get("user_id") in all_user_ids)

        trial_expired_sub_ids = _cache_get("trial_expired_sub_ids") or set()

        # --- Build time-filtered user subsets ---
        now = datetime.utcnow()
        cutoff_24h = (now - timedelta(hours=24)).isoformat()
        cutoff_7d_users = (now - timedelta(days=7)).isoformat()

        users_24h = [u for u in all_users if u.get("created_at", "") >= cutoff_24h]
        users_7d = [u for u in all_users if u.get("created_at", "") >= cutoff_7d_users]

        shared = dict(profile_ids=profile_ids, plan_ids=plan_ids, messaged_ids=messaged_ids,
                      ever_workout_ids=ever_workout_ids, recent_msg_ids=recent_msg_ids,
                      recent_workout_ids=recent_workout_ids, trial_expired_sub_ids=trial_expired_sub_ids)

        # --- Classify each subset (pure Python, no extra queries) ---
        result["24h"] = _classify_users(users_24h, **shared)
        result["7d"] = _classify_users(users_7d, **shared)
        result["lifetime"] = _classify_users(all_users, **shared)

        logger.info(
            f"Lifecycle: 24h={result['24h']['total']}, 7d={result['7d']['total']}, lifetime={result['lifetime']['total']}"
        )

    except Exception as e:
        logger.error(f"Error getting user lifecycle: {e}")

    return result


async def get_recent_cancellations(all_users: list, limit: int = 10) -> list:
    """
    Get recently canceled/unsubscribed users with their details.
    Uses cached Stripe interval map instead of per-user API calls.
    """
    supabase = get_supabase()
    result = []

    try:
        # Filter and sort cancelled users from pre-fetched data
        canceled_users = sorted(
            [u for u in all_users if u.get("subscription_status") in ("canceled", "cancelled")],
            key=lambda u: u.get("updated_at", ""),
            reverse=True
        )[:limit]

        if not canceled_users:
            return result

        user_ids = [u["id"] for u in canceled_users]

        profiles = supabase.table("profiles").select(
            "user_id, name, phone"
        ).in_("user_id", user_ids).execute()

        profile_map = {p["user_id"]: p for p in (profiles.data or [])}

        # Use cached interval map from get_mrr_from_stripe (no per-user Stripe calls)
        sub_interval_map = _cache_get("sub_interval_map") or {}

        for user in canceled_users:
            profile = profile_map.get(user["id"], {})

            updated_at = user.get("updated_at")
            created_at = user.get("created_at")

            duration_days = None
            if created_at and updated_at:
                try:
                    created = datetime.fromisoformat(created_at.replace("Z", "+00:00")) if isinstance(created_at, str) else created_at
                    updated = datetime.fromisoformat(updated_at.replace("Z", "+00:00")) if isinstance(updated_at, str) else updated_at
                    if created and updated:
                        duration_days = (updated - created).days
                except Exception:
                    pass

            plan_type = None
            sub_id = user.get("stripe_subscription_id")
            if sub_id and sub_id in sub_interval_map:
                interval = sub_interval_map[sub_id]
                plan_type = "yearly" if interval == "year" else "monthly"

            result.append({
                "user_id": user["id"],
                "name": profile.get("name") or "Unknown",
                "email": user.get("email") or "No email",
                "phone": profile.get("phone") or "",
                "canceled_at": updated_at,
                "created_at": created_at,
                "duration_days": duration_days,
                "plan_type": plan_type,
            })

        return result

    except Exception as e:
        logger.error(f"Error getting recent cancellations: {e}")
        return result


async def get_delivery_rate(days: int = 7, exclude_user_ids: set = None) -> dict:
    """Get message delivery success rate, excluding test users."""
    supabase = get_supabase()
    result = {"rate": 0, "sent": 0, "failed": 0, "total": 0}

    try:
        cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()

        if exclude_user_ids:
            # Fetch messages and filter out test users in-memory
            sent_result = supabase.table("scheduled_messages").select("user_id").eq(
                "status", "sent"
            ).gte("created_at", cutoff).execute()
            result["sent"] = sum(1 for m in (sent_result.data or []) if m.get("user_id") not in exclude_user_ids)

            failed_result = supabase.table("scheduled_messages").select("user_id").eq(
                "status", "failed"
            ).gte("created_at", cutoff).execute()
            result["failed"] = sum(1 for m in (failed_result.data or []) if m.get("user_id") not in exclude_user_ids)
        else:
            sent = supabase.table("scheduled_messages").select("id", count="exact").eq(
                "status", "sent"
            ).gte("created_at", cutoff).execute()
            result["sent"] = sent.count or 0

            failed = supabase.table("scheduled_messages").select("id", count="exact").eq(
                "status", "failed"
            ).gte("created_at", cutoff).execute()
            result["failed"] = failed.count or 0

        result["total"] = result["sent"] + result["failed"]

        if result["total"] > 0:
            result["rate"] = round((result["sent"] / result["total"]) * 100, 1)
        else:
            result["rate"] = 100

    except Exception as e:
        logger.error(f"Error getting delivery rate: {e}")

    return result


async def get_workout_completion_today(all_users: list) -> dict:
    """
    Get % of active subscribers who completed today's workout.
    Uses pre-fetched users list instead of re-querying.
    """
    supabase = get_supabase()
    result = {
        "rate": 0,
        "completed": 0,
        "scheduled": 0,
        "rest_day": 0,
        "total_active": 0
    }

    try:
        today = datetime.utcnow()
        today_day = today.strftime("%A")
        today_start = today.replace(hour=0, minute=0, second=0, microsecond=0)

        active_user_ids = [u["id"] for u in all_users if u.get("subscription_status") == "active"]
        result["total_active"] = len(active_user_ids)

        if not active_user_ids:
            return result

        plans = supabase.table("workout_plans").select(
            "user_id, plan_data"
        ).in_("user_id", active_user_ids).eq("status", "active").execute()

        users_with_workout_today = set()
        users_on_rest_day = set()

        for plan in (plans.data or []):
            user_id = plan.get("user_id")
            plan_data = plan.get("plan_data", {})

            if isinstance(plan_data, dict) and "workouts" in plan_data:
                has_workout_today = any(w.get("day") == today_day for w in plan_data["workouts"])
                if has_workout_today:
                    users_with_workout_today.add(user_id)
                else:
                    users_on_rest_day.add(user_id)
            else:
                users_on_rest_day.add(user_id)

        users_with_plans = set(p.get("user_id") for p in (plans.data or []))
        for user_id in active_user_ids:
            if user_id not in users_with_plans:
                users_on_rest_day.add(user_id)

        result["scheduled"] = len(users_with_workout_today)
        result["rest_day"] = len(users_on_rest_day)

        completed = supabase.table("workout_sessions").select("user_id").eq(
            "status", "completed"
        ).gte("workout_date", today_start.isoformat()).execute()

        completed_user_ids = set(c.get("user_id") for c in (completed.data or []))
        result["completed"] = len(completed_user_ids & users_with_workout_today)

        if result["scheduled"] > 0:
            result["rate"] = round((result["completed"] / result["scheduled"]) * 100, 1)

    except Exception as e:
        logger.error(f"Error getting workout completion: {e}")

    return result


async def get_subscription_breakdown_with_interval(all_users: list) -> dict:
    """
    Get subscription breakdown using pre-fetched users and cached Stripe interval map.
    No individual Stripe API calls.
    """
    result = {
        "by_status": {},
        "by_interval": {"monthly": 0, "yearly": 0, "none": 0}
    }

    try:
        # Count by status from pre-fetched data
        for user in all_users:
            status = user.get("subscription_status") or "none"
            result["by_status"][status] = result["by_status"].get(status, 0) + 1

        # Use cached interval map from get_mrr_from_stripe (no per-user Stripe calls)
        sub_interval_map = _cache_get("sub_interval_map") or {}

        for user in all_users:
            sub_id = user.get("stripe_subscription_id")
            if sub_id and sub_id in sub_interval_map:
                interval = sub_interval_map[sub_id]
                if interval == "year":
                    result["by_interval"]["yearly"] += 1
                else:
                    result["by_interval"]["monthly"] += 1
            else:
                result["by_interval"]["none"] += 1

    except Exception as e:
        logger.error(f"Error getting subscription breakdown: {e}")

    return result


# =============================================================================
# Dashboard
# =============================================================================

@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    """Main dashboard with stats and charts."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    supabase = get_supabase()

    # Fetch users table ONCE — shared across multiple helpers
    all_users = []
    try:
        users_result = supabase.table("users").select(
            "id, subscription_status, stripe_subscription_id, created_at, updated_at, email, is_test_user, stripe_customer_id"
        ).execute()
        all_users = users_result.data or []
    except Exception as e:
        logger.error(f"Error fetching users: {e}")

    # Separate test users so they're excluded from all dashboard metrics
    test_user_ids = {u["id"] for u in all_users if u.get("is_test_user")}
    test_user_stripe_customer_ids = {
        u["stripe_customer_id"] for u in all_users
        if u.get("is_test_user") and u.get("stripe_customer_id")
    }
    real_users = [u for u in all_users if not u.get("is_test_user")]

    # Basic stats (count queries)
    async def get_basic_stats():
        stats = {
            "total_users": 0,
            "pending_messages": 0,
            "messages_today": 0,
            "messages_week": 0,
            "failed_24h": 0,
            "sent_24h": 0,
            "inbound_24h": 0,
            "outbound_24h": 0,
            "subscriptions": {}
        }
        try:
            profiles = supabase.table("profiles").select("id", count="exact").execute()
            stats["total_users"] = profiles.count or 0

            pending = supabase.table("scheduled_messages").select("id", count="exact").eq("status", "pending").execute()
            stats["pending_messages"] = pending.count or 0

            today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            messages_today = supabase.table("messages").select("id", count="exact").gte("created_at", today.isoformat()).execute()
            stats["messages_today"] = messages_today.count or 0

            week_ago = today - timedelta(days=7)
            messages_week = supabase.table("messages").select("id", count="exact").gte("created_at", week_ago.isoformat()).execute()
            stats["messages_week"] = messages_week.count or 0

            yesterday = datetime.utcnow() - timedelta(hours=24)
            failed = supabase.table("scheduled_messages").select("id", count="exact").eq("status", "failed").gte("created_at", yesterday.isoformat()).execute()
            stats["failed_24h"] = failed.count or 0

            sent = supabase.table("scheduled_messages").select("id", count="exact").eq("status", "sent").gte("sent_at", yesterday.isoformat()).execute()
            stats["sent_24h"] = sent.count or 0

            inbound = supabase.table("messages").select("id", count="exact").eq("direction", "inbound").gte("created_at", yesterday.isoformat()).execute()
            stats["inbound_24h"] = inbound.count or 0

            outbound = supabase.table("messages").select("id", count="exact").eq("direction", "outbound").gte("created_at", yesterday.isoformat()).execute()
            stats["outbound_24h"] = outbound.count or 0

            # Use pre-fetched users for subscription breakdown (exclude test users)
            for user in real_users:
                status = user.get("subscription_status") or "none"
                stats["subscriptions"][status] = stats["subscriptions"].get(status, 0) + 1

        except Exception as e:
            logger.error(f"Error fetching dashboard stats: {e}")
        return stats

    # Run MRR first (populates cache used by cancellations and subscription breakdown)
    mrr_data = await get_mrr_from_stripe(exclude_customer_ids=test_user_stripe_customer_ids)

    # Run all remaining helpers concurrently
    (
        stats,
        signups_data,
        engagement,
        delivery_rate,
        workout_completion,
        subscription_breakdown,
        user_funnel,
        recent_cancellations,
        ai_usage,
    ) = await asyncio.gather(
        get_basic_stats(),
        get_signups_by_day(real_users, days=30),
        get_engagement_breakdown(real_users, days=7),
        get_delivery_rate(days=7, exclude_user_ids=test_user_ids),
        get_workout_completion_today(real_users),
        get_subscription_breakdown_with_interval(real_users),
        get_user_funnel(real_users),
        get_recent_cancellations(real_users, limit=10),
        get_usage_stats(days=7),
    )

    return templates.TemplateResponse("dashboard.html", {
        "request": request,
        "authenticated": True,
        "active_page": "dashboard",
        "stats": stats,
        "signups_data": signups_data,
        "mrr_data": mrr_data,
        "engagement": engagement,
        "delivery_rate": delivery_rate,
        "workout_completion": workout_completion,
        "subscription_breakdown": subscription_breakdown,
        "user_funnel": user_funnel,
        "recent_cancellations": recent_cancellations,
        "ai_usage": ai_usage
    })


# =============================================================================
# Message Queue
# =============================================================================

@router.get("/queue", response_class=HTMLResponse)
async def queue_page(request: Request, status: Optional[str] = Query(None)):
    """Message queue page."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    supabase = get_supabase()
    central_tz = get_admin_tz(request)
    utc_tz = ZoneInfo("UTC")

    # Get counts
    counts = {"pending": 0, "sent": 0, "failed": 0}
    try:
        for s in ["pending", "sent", "failed"]:
            result = supabase.table("scheduled_messages").select("id", count="exact").eq("status", s).execute()
            counts[s] = result.count or 0
    except Exception as e:
        logger.error(f"Error getting counts: {e}")

    # Get messages
    messages = []
    try:
        query = supabase.table("scheduled_messages").select("*").order("scheduled_time", desc=True).limit(100)
        if status:
            query = query.eq("status", status)
        result = query.execute()

        # Get all user_ids to fetch names
        user_ids = list(set(msg["user_id"] for msg in result.data or []))
        names = {}
        if user_ids:
            profiles = supabase.table("profiles").select("user_id, name").in_("user_id", user_ids).execute()
            names = {p["user_id"]: p["name"] for p in profiles.data or []}

        for msg in result.data or []:
            scheduled_utc = datetime.fromisoformat(msg["scheduled_time"].replace("Z", "+00:00"))
            if scheduled_utc.tzinfo is None:
                scheduled_utc = scheduled_utc.replace(tzinfo=utc_tz)
            scheduled_local = scheduled_utc.astimezone(central_tz)

            messages.append({
                "id": msg["id"],
                "name": names.get(msg["user_id"], "Unknown"),
                "phone_number": msg["phone_number"],
                "scheduled_local": scheduled_local.strftime("%Y-%m-%d %I:%M %p"),
                "status": msg["status"],
                "error_message": msg.get("error_message"),
                "sent_at": msg.get("sent_at")
            })
    except Exception as e:
        logger.error(f"Error fetching messages: {e}", exc_info=True)

    return templates.TemplateResponse("queue.html", {
        "request": request,
        "authenticated": True,
        "active_page": "queue",
        "messages": messages,
        "counts": counts,
        "filter_status": status
    })


@router.post("/queue/cancel/{message_id}")
async def cancel_message(request: Request, message_id: int):
    """Cancel a pending message."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        supabase = get_supabase()
        supabase.table("scheduled_messages").update({
            "status": "failed",
            "error_message": "Cancelled by admin"
        }).eq("id", message_id).eq("status", "pending").execute()

        logger.info(f"Admin cancelled message {message_id}")
    except Exception as e:
        logger.error(f"Error cancelling message: {e}")

    return RedirectResponse(url="/admin/queue?status=pending", status_code=303)


@router.post("/queue/send/{message_id}")
async def send_message_now(request: Request, message_id: int):
    """Send a pending message immediately."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        supabase = get_supabase()

        # Get the message
        result = supabase.table("scheduled_messages").select("*").eq("id", message_id).eq("status", "pending").execute()

        if result.data:
            msg = result.data[0]

            # Get user profile for AI generation
            profile = supabase.table("profiles").select("*").eq("user_id", msg["user_id"]).execute()

            if profile.data:
                from app.services.ai_agent import get_ai_agent
                from app.prompts.loader import get_prompt

                user_profile = profile.data[0]

                # Generate message
                prompt_template = get_prompt("daily_message")
                ai_agent = get_ai_agent()
                message_text = await ai_agent.generate_daily_message(
                    prompt_template=prompt_template,
                    user_name=user_profile.get("name", "there"),
                    workout_today=None,
                    goal=user_profile.get("goal", "fitness"),
                    recent_activity=None
                )

                # Send via Mac server
                from app.db.models import OutboundMessageChunk
                mac_client = MacServerClient()
                await mac_client.send_message(
                    phone_number=msg["phone_number"],
                    messages=[OutboundMessageChunk(text=message_text)]
                )

                # Update status
                supabase.table("scheduled_messages").update({
                    "status": "sent",
                    "sent_at": datetime.utcnow().isoformat(),
                    "message_content": message_text
                }).eq("id", message_id).execute()

                logger.info(f"Admin sent message {message_id}")

    except Exception as e:
        logger.error(f"Error sending message: {e}")
        supabase.table("scheduled_messages").update({
            "status": "failed",
            "error_message": str(e)
        }).eq("id", message_id).execute()

    return RedirectResponse(url="/admin/queue?status=pending", status_code=303)


# =============================================================================
# Manual Actions
# =============================================================================

@router.get("/actions", response_class=HTMLResponse)
async def actions_page(request: Request):
    """Manual actions page."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    flash_message = request.query_params.get("flash")
    flash_type = request.query_params.get("type", "success")

    return templates.TemplateResponse("actions.html", {
        "request": request,
        "authenticated": True,
        "active_page": "actions",
        "flash_message": flash_message,
        "flash_type": flash_type
    })


@router.post("/actions/schedule-daily")
async def trigger_schedule_daily(request: Request):
    """Trigger daily scheduling script."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        from scripts.schedule_daily_messages import schedule_daily_messages
        scheduled, errors = schedule_daily_messages()
        message = f"Scheduled {scheduled} messages, {errors} errors"
        return RedirectResponse(url=f"/admin/actions?flash={message}&type=success", status_code=303)
    except Exception as e:
        return RedirectResponse(url=f"/admin/actions?flash=Error: {e}&type=error", status_code=303)


@router.post("/actions/send-pending")
async def trigger_send_pending(request: Request):
    """Trigger sending pending messages."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        from scripts.send_scheduled_messages import send_scheduled_messages
        import asyncio
        sent, failed = asyncio.get_event_loop().run_until_complete(send_scheduled_messages())
        message = f"Sent {sent} messages, {failed} failed"
        return RedirectResponse(url=f"/admin/actions?flash={message}&type=success", status_code=303)
    except Exception as e:
        return RedirectResponse(url=f"/admin/actions?flash=Error: {e}&type=error", status_code=303)


@router.post("/actions/send-test")
async def send_test_message(request: Request, phone: str = Form(...), message: str = Form(...)):
    """Send a test message."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        mac_client = MacServerClient()
        await mac_client.send_message(
            phone_number=phone,
            messages=[{"text": message}]
        )
        return RedirectResponse(url=f"/admin/actions?flash=Test message sent to {phone}&type=success", status_code=303)
    except Exception as e:
        return RedirectResponse(url=f"/admin/actions?flash=Error: {e}&type=error", status_code=303)


@router.post("/actions/schedule-user")
async def schedule_user(request: Request, user_id: str = Form(...)):
    """Schedule message for a specific user."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        message_id = schedule_user_message(user_id)
        if message_id:
            return RedirectResponse(url=f"/admin/actions?flash=Scheduled message {message_id} for user&type=success", status_code=303)
        else:
            return RedirectResponse(url=f"/admin/actions?flash=Could not schedule - check user profile&type=error", status_code=303)
    except Exception as e:
        return RedirectResponse(url=f"/admin/actions?flash=Error: {e}&type=error", status_code=303)


# =============================================================================
# User Management
# =============================================================================

@router.get("/users", response_class=HTMLResponse)
async def users_page(
    request: Request,
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    interval: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    flash: Optional[str] = Query(None),
    type: Optional[str] = Query(None)
):
    """User list page with search and filter."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    supabase = get_supabase()
    per_page = 999999  # Show all users on one page
    offset = (page - 1) * per_page

    # Fetch all users once for stats + list building
    all_users_data = []
    try:
        users_result = supabase.table("users").select("*").execute()
        all_users_data = users_result.data or []
    except Exception as e:
        logger.error(f"Error fetching users: {e}")

    # Compute stats from the single fetch (exclude test users from counts)
    stats = {"total": 0, "active": 0, "trialing": 0, "paused": 0, "onboarding": 0}
    real_users_data = [u for u in all_users_data if not u.get("is_test_user")]
    stats["total"] = len(real_users_data)
    for u in real_users_data:
        sub_status = u.get("subscription_status")
        if sub_status == "active":
            stats["active"] += 1
        elif sub_status == "trialing":
            stats["trialing"] += 1
        elif not sub_status or sub_status in ("incomplete", "incomplete_expired", None):
            stats["onboarding"] += 1

    try:
        paused = supabase.table("profiles").select("id", count="exact").eq("messaging_paused", True).execute()
        stats["paused"] = paused.count or 0
    except Exception as e:
        logger.error(f"Error getting paused count: {e}")

    # Get promo redemptions to determine signup source
    promo_users = {}
    try:
        promo_result = supabase.table("promo_redemptions").select(
            "user_id, promo_codes(code)"
        ).execute()
        for r in promo_result.data or []:
            uid = r.get("user_id")
            promo_code = r.get("promo_codes", {}).get("code") if r.get("promo_codes") else None
            promo_users[uid] = promo_code
    except Exception as e:
        logger.error(f"Error fetching promo redemptions: {e}")

    # Use cached Stripe interval map instead of fetching all subscriptions
    subscription_intervals = _cache_get("sub_interval_map") or {}

    # Build query for user list
    users = []
    total_count = 0

    try:
        all_users = []

        # Batch-fetch all profiles keyed by user_id (used for all paths)
        all_profiles_map = {}
        try:
            profiles_result = supabase.table("profiles").select("*").execute()
            all_profiles_map = {p["user_id"]: p for p in (profiles_result.data or [])}
        except Exception as e:
            logger.error(f"Error fetching profiles: {e}")

        # Fetch lifecycle lookup sets (same as dashboard funnel)
        all_ids = set(u.get("id") for u in all_users_data)

        plans_result = supabase.table("workout_plans").select("user_id").eq("status", "active").execute()
        plan_ids = set(p["user_id"] for p in (plans_result.data or []) if p.get("user_id") in all_ids)

        msgs_result = supabase.table("messages").select("user_id").eq("direction", "inbound").execute()
        messaged_ids = set(m["user_id"] for m in (msgs_result.data or []) if m.get("user_id") in all_ids)

        workouts_result = supabase.table("workout_sessions").select("user_id").eq("status", "completed").execute()
        ever_workout_ids = set(w["user_id"] for w in (workouts_result.data or []) if w.get("user_id") in all_ids)

        trial_expired_sub_ids = _cache_get("trial_expired_sub_ids") or set()

        # Determine which users to include
        if status == "onboarding":
            target_users = [
                u for u in all_users_data
                if not u.get("subscription_status") or u.get("subscription_status") in ("incomplete", "incomplete_expired")
            ]
        elif status:
            target_users = [u for u in all_users_data if u.get("subscription_status") == status]
        else:
            target_users = list(all_users_data)

        for user_data in target_users:
            user_id = user_data.get("id")
            profile = all_profiles_map.get(user_id, {})
            draft_data = user_data.get("draft_onboarding_data", {}) or {}
            sub_status = user_data.get("subscription_status")
            is_onboarding = not sub_status or sub_status in ("incomplete", "incomplete_expired")

            name = profile.get("name") or draft_data.get("name") or user_data.get("first_name") or "Unknown"
            email = user_data.get("email") or ""
            phone = profile.get("phone") or draft_data.get("phone")
            phone_verified = profile.get("phone_verified", False)

            if search:
                search_lower = search.lower()
                phone_str = phone or ""
                if not (search_lower in name.lower() or search_lower in email.lower() or search_lower in phone_str):
                    continue

            sub_id = user_data.get("stripe_subscription_id")
            signup_source = None
            promo_code = None
            if user_id in promo_users:
                signup_source = "promo"
                promo_code = promo_users.get(user_id)
            elif sub_id:
                signup_source = "stripe"

            plan_interval = subscription_intervals.get(sub_id) if sub_id else None

            # Classify into lifecycle stage (matches dashboard funnel)
            has_plan = user_id in plan_ids
            has_messaged = user_id in messaged_ids
            has_workout = user_id in ever_workout_ids
            has_plan_and_msg = has_plan and has_messaged

            if is_onboarding:
                lifecycle_stage = "onboarding"
            elif sub_status in ("canceled", "cancelled"):
                stripe_sub_id = user_data.get("stripe_subscription_id")
                if stripe_sub_id and stripe_sub_id in trial_expired_sub_ids:
                    lifecycle_stage = "expired_trial"
                else:
                    lifecycle_stage = "churned"
            elif sub_status in ("trialing", "active"):
                if has_plan_and_msg:
                    lifecycle_stage = sub_status  # "trialing" or "active"
                else:
                    lifecycle_stage = "stuck_activation"
            else:
                lifecycle_stage = "onboarding"

            all_users.append({
                "user_id": user_id,
                "name": name,
                "email": email,
                "phone": phone,
                "phone_verified": phone_verified,
                "goal": profile.get("goal") or draft_data.get("goal") or "Not set",
                "subscription_status": "onboarding" if is_onboarding else sub_status,
                "messaging_paused": profile.get("messaging_paused", False),
                "signup_source": signup_source,
                "promo_code": promo_code,
                "plan_interval": plan_interval,
                "is_onboarding": is_onboarding,
                "signup_stage": user_data.get("signup_stage") if is_onboarding else None,
                "created_at": user_data.get("created_at"),
                "is_test_user": user_data.get("is_test_user", False),
                "lifecycle_stage": lifecycle_stage,
                "has_plan": has_plan,
                "has_messaged": has_messaged,
                "has_workout": has_workout,
            })

        if source == "promo":
            all_users = [u for u in all_users if u["signup_source"] == "promo"]
        elif source == "stripe":
            all_users = [u for u in all_users if u["signup_source"] == "stripe"]

        if interval:
            all_users = [u for u in all_users if u["plan_interval"] == interval]

        # Sort by most recent signup first
        all_users.sort(key=lambda x: x.get("created_at") or "", reverse=True)

        # Separate test users from real users
        test_users = [u for u in all_users if u.get("is_test_user")]
        all_users = [u for u in all_users if not u.get("is_test_user")]

        total_count = len(all_users)
        users = all_users[offset:offset + per_page]

    except Exception as e:
        logger.error(f"Error fetching users: {e}", exc_info=True)

    total_pages = (total_count + per_page - 1) // per_page if total_count > 0 else 1

    return templates.TemplateResponse("users.html", {
        "request": request,
        "authenticated": True,
        "active_page": "users",
        "users": users,
        "test_users": test_users,
        "stats": stats,
        "search": search,
        "filter_status": status,
        "filter_source": source,
        "filter_interval": interval,
        "page": page,
        "total_pages": total_pages,
        "flash_message": flash,
        "flash_type": type or "success"
    })


def calculate_profile_completion(profile: dict) -> dict:
    """Calculate profile completion percentage and missing fields."""
    required_fields = ["name", "phone", "goal"]
    optional_fields = ["age", "sex", "consistency", "experience", "equipment", "split", "workout_days", "preferred_text_time", "timezone"]

    filled = 0
    total = len(required_fields) + len(optional_fields)
    missing = []

    for field in required_fields:
        if profile.get(field):
            filled += 1
        else:
            missing.append(field)

    for field in optional_fields:
        val = profile.get(field)
        if val is not None and val != "" and val != []:
            filled += 1
        else:
            missing.append(field)

    percentage = round(filled / total * 100) if total > 0 else 0

    return {
        "filled": filled,
        "total": total,
        "percentage": percentage,
        "missing": missing
    }


@router.get("/users/{user_id}", response_class=HTMLResponse)
async def user_detail(
    request: Request,
    user_id: str,
    flash: Optional[str] = Query(None),
    type: Optional[str] = Query(None)
):
    """User detail page."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    supabase = get_supabase()
    central_tz = get_admin_tz(request)
    utc_tz = ZoneInfo("UTC")

    user = None
    profile = None
    messages = []
    scheduled_messages = []
    workout_plan = None
    adherence = None
    profile_completion = None

    try:
        # Get user
        user_result = supabase.table("users").select("*").eq("id", user_id).execute()
        if user_result.data:
            user = user_result.data[0]

        # Get profile
        profile_result = supabase.table("profiles").select("*").eq("user_id", user_id).execute()
        if profile_result.data:
            profile = profile_result.data[0]

        if not user:
            return RedirectResponse(url="/admin/users?flash=User not found&type=error", status_code=303)

        if not profile:
            profile = {}

        # Calculate profile completion
        if profile:
            profile_completion = calculate_profile_completion(profile)
        else:
            profile_completion = {"filled": 0, "total": 0, "percentage": 0, "missing": []}

        # Get workout plan
        plan_result = supabase.table("workout_plans") \
            .select("*") \
            .eq("user_id", user_id) \
            .eq("status", "active") \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()

        if plan_result.data:
            workout_plan = plan_result.data[0]
            # Format plan created_at
            if workout_plan.get("created_at"):
                plan_created = datetime.fromisoformat(workout_plan["created_at"].replace("Z", "+00:00"))
                if plan_created.tzinfo is None:
                    plan_created = plan_created.replace(tzinfo=utc_tz)
                plan_local = plan_created.astimezone(central_tz)
                workout_plan["created_at_local"] = plan_local.strftime("%b %d, %Y")

        # Get workout adherence
        adherence = get_workout_adherence(user_id, days=30)

        # Get recent messages
        messages_result = supabase.table("messages").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(50).execute()

        for msg in messages_result.data or []:
            # Handle null created_at
            created_at_local = "Unknown"
            if msg.get("created_at"):
                created_utc = datetime.fromisoformat(msg["created_at"].replace("Z", "+00:00"))
                if created_utc.tzinfo is None:
                    created_utc = created_utc.replace(tzinfo=utc_tz)
                created_local = created_utc.astimezone(central_tz)
                created_at_local = created_local.strftime("%m/%d %I:%M %p")

            messages.append({
                "id": msg["id"],
                "direction": msg["direction"],
                "content": msg["content"],
                "created_at_local": created_at_local
            })

        # Get scheduled messages
        scheduled_result = supabase.table("scheduled_messages").select("*").eq("user_id", user_id).order("scheduled_time", desc=True).limit(20).execute()

        for msg in scheduled_result.data or []:
            scheduled_utc = datetime.fromisoformat(msg["scheduled_time"].replace("Z", "+00:00"))
            if scheduled_utc.tzinfo is None:
                scheduled_utc = scheduled_utc.replace(tzinfo=utc_tz)
            scheduled_local = scheduled_utc.astimezone(central_tz)

            scheduled_messages.append({
                "id": msg["id"],
                "scheduled_time_local": scheduled_local.strftime("%m/%d/%Y %I:%M %p"),
                "status": msg["status"],
                "error_message": msg.get("error_message")
            })

    except Exception as e:
        logger.error(f"Error fetching user detail: {e}", exc_info=True)
        return RedirectResponse(url="/admin/users?flash=Error loading user&type=error", status_code=303)

    return templates.TemplateResponse("user_detail.html", {
        "request": request,
        "authenticated": True,
        "active_page": "users",
        "user": user,
        "profile": profile,
        "messages": messages,
        "scheduled_messages": scheduled_messages,
        "workout_plan": workout_plan,
        "adherence": adherence,
        "profile_completion": profile_completion,
        "flash_message": flash,
        "flash_type": type or "success"
    })


@router.post("/users/{user_id}/toggle-pause")
async def toggle_user_pause(request: Request, user_id: str):
    """Toggle messaging pause for a user."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        supabase = get_supabase()

        # Get current status
        profile = supabase.table("profiles").select("messaging_paused").eq("user_id", user_id).execute()

        if profile.data:
            current_paused = profile.data[0].get("messaging_paused", False)
            new_paused = not current_paused

            supabase.table("profiles").update({
                "messaging_paused": new_paused
            }).eq("user_id", user_id).execute()

            status = "paused" if new_paused else "resumed"
            logger.info(f"Admin {status} messaging for user {user_id}")

    except Exception as e:
        logger.error(f"Error toggling pause: {e}")

    # Redirect back to referring page
    referer = request.headers.get("referer", "/admin/users")
    return RedirectResponse(url=referer, status_code=303)


@router.post("/users/{user_id}/toggle-test-user")
async def toggle_test_user(request: Request, user_id: str):
    """Toggle is_test_user flag for a user."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        supabase = get_supabase()
        user_result = supabase.table("users").select("is_test_user").eq("id", user_id).execute()

        if user_result.data:
            current = user_result.data[0].get("is_test_user", False)
            supabase.table("users").update({
                "is_test_user": not current
            }).eq("id", user_id).execute()

            status = "marked as test user" if not current else "unmarked as test user"
            logger.info(f"Admin {status}: {user_id}")

            # Invalidate MRR cache since test user filtering affects it
            _cache.pop("mrr_data", None)
            _cache.pop("mrr_data_filtered", None)

    except Exception as e:
        logger.error(f"Error toggling test user: {e}")

    return RedirectResponse(url=f"/admin/users/{user_id}", status_code=303)


@router.post("/users/{user_id}/schedule-message")
async def schedule_user_message_now(request: Request, user_id: str):
    """Schedule a message for user right now."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        message_id = schedule_user_message(user_id)
        if message_id:
            logger.info(f"Admin scheduled message {message_id} for user {user_id}")
        return RedirectResponse(url=f"/admin/users/{user_id}", status_code=303)
    except Exception as e:
        logger.error(f"Error scheduling message: {e}")
        return RedirectResponse(url=f"/admin/users/{user_id}", status_code=303)


@router.post("/users/{user_id}/send-daily-message")
async def send_daily_message_now(request: Request, user_id: str):
    """Send today's daily message to user immediately."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        supabase = get_supabase()

        # Get user data
        user_result = supabase.table("users").select("*").eq("id", user_id).execute()
        if not user_result.data:
            return RedirectResponse(
                url=f"/admin/users/{user_id}?flash=User not found&type=error",
                status_code=303
            )
        user_data = user_result.data[0]

        # Get user's profile
        profile_result = supabase.table("profiles").select("*").eq("user_id", user_id).execute()
        if not profile_result.data:
            logger.error(f"No profile found for user {user_id}")
            return RedirectResponse(
                url=f"/admin/users/{user_id}?flash=User profile not found&type=error",
                status_code=303
            )

        profile = profile_result.data[0]
        phone_number = profile.get("phone")
        user_name = profile.get("name", "User")

        if not phone_number:
            return RedirectResponse(
                url=f"/admin/users/{user_id}?flash=User has no phone number&type=error",
                status_code=303
            )

        # Generate today's daily message using the same templates as scheduled messages
        from scripts.send_scheduled_messages import format_daily_message
        from app.db.models import OutboundMessageChunk

        message_parts = format_daily_message(user_data, profile)

        if not message_parts:
            return RedirectResponse(
                url=f"/admin/users/{user_id}?flash=Could not generate daily message (no workout plan?)&type=error",
                status_code=303
            )

        # Send the message (all bubbles)
        mac_client = MacServerClient()
        await mac_client.send_message(
            phone_number=phone_number,
            messages=[OutboundMessageChunk(text=part) for part in message_parts],
            delay_before_typing=1.0,
            typing_duration=2.0
        )

        logger.info(f"Admin sent today's daily message to {user_id} ({phone_number})")
        return RedirectResponse(
            url=f"/admin/users/{user_id}?flash=Daily message sent to {user_name}&type=success",
            status_code=303
        )

    except Exception as e:
        logger.error(f"Error sending daily message: {e}", exc_info=True)
        return RedirectResponse(
            url=f"/admin/users/{user_id}?flash=Error sending message: {str(e)}&type=error",
            status_code=303
        )


@router.post("/users/{user_id}/delete")
async def delete_user(request: Request, user_id: str):
    """Delete a user from both Supabase Auth and database."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        supabase = get_supabase()

        # 1. Cancel Stripe subscription if exists
        user_result = supabase.table("users").select("stripe_subscription_id").eq("id", user_id).single().execute()
        if user_result.data and user_result.data.get("stripe_subscription_id"):
            subscription_id = user_result.data["stripe_subscription_id"]
            try:
                if settings.stripe_secret_key:
                    stripe.api_key = settings.stripe_secret_key
                    stripe.Subscription.cancel(subscription_id)
                    logger.info(f"Cancelled Stripe subscription {subscription_id} for user {user_id}")
                else:
                    logger.warning(f"STRIPE_SECRET_KEY not configured, skipping subscription cancellation for {subscription_id}")
            except stripe.error.InvalidRequestError as e:
                # Subscription may already be cancelled or not exist
                logger.warning(f"Could not cancel Stripe subscription {subscription_id}: {e}")
            except Exception as e:
                logger.error(f"Error cancelling Stripe subscription {subscription_id}: {e}")
                # Continue with deletion even if Stripe cancellation fails

        # 2. Delete scheduled messages first (no cascade)
        supabase.table("scheduled_messages").delete().eq("user_id", user_id).execute()
        logger.info(f"Deleted scheduled messages for user {user_id}")

        # 2b. Delete phone verifications for this user's phone
        profile_result = supabase.table("profiles").select("phone").eq("user_id", user_id).limit(1).execute()
        phone = None
        if profile_result.data:
            phone = profile_result.data[0].get("phone")
        else:
            # Check draft_onboarding_data for phone
            user_data = supabase.table("users").select("draft_onboarding_data").eq("id", user_id).limit(1).execute()
            if user_data.data:
                draft = user_data.data[0].get("draft_onboarding_data") or {}
                phone = draft.get("phone")
                # Normalize to E.164 if needed
                if phone and not phone.startswith("+"):
                    phone = f"+1{phone}" if len(phone) == 10 else phone

        if phone:
            supabase.table("phone_verifications").delete().eq("phone_number", phone).execute()
            logger.info(f"Deleted phone verifications for {phone}")

        # 3. Delete from Supabase Auth
        supabase.auth.admin.delete_user(user_id)
        logger.info(f"Deleted user {user_id} from Supabase Auth")

        # 4. Delete from users table (cascade handles profiles, messages, etc.)
        supabase.table("users").delete().eq("id", user_id).execute()
        logger.info(f"Deleted user {user_id} from database")

        return RedirectResponse(
            url="/admin/users?flash=User deleted successfully&type=success",
            status_code=303
        )
    except Exception as e:
        logger.error(f"Error deleting user {user_id}: {e}", exc_info=True)
        return RedirectResponse(
            url=f"/admin/users/{user_id}?flash=Error deleting user&type=error",
            status_code=303
        )


@router.post("/users/{user_id}/clear-messages")
async def clear_user_messages(request: Request, user_id: str):
    """Clear all conversation history for a user."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        supabase = get_supabase()

        # Delete all messages for this user
        result = supabase.table("messages").delete().eq("user_id", user_id).execute()

        deleted_count = len(result.data) if result.data else 0
        logger.info(f"Cleared {deleted_count} messages for user {user_id}")

        return RedirectResponse(
            url=f"/admin/users/{user_id}?flash=Cleared {deleted_count} messages&type=success",
            status_code=303
        )
    except Exception as e:
        logger.error(f"Error clearing messages for user {user_id}: {e}", exc_info=True)
        return RedirectResponse(
            url=f"/admin/users/{user_id}?flash=Error clearing messages&type=error",
            status_code=303
        )


# =============================================================================
# Error Monitoring
# =============================================================================

ERROR_PATTERNS = {
    "timeout": ["timeout", "timed out"],
    "mac_server": ["Mac server", "connection refused", "Connection refused"],
    "openai": ["OpenAI", "rate limit", "API error", "openai"],
    "validation": ["not found", "invalid", "validation"],
    "cancelled": ["Cancelled by admin"]
}


def classify_error(error_message: str) -> str:
    """Classify error by type based on message content."""
    if not error_message:
        return "other"
    for error_type, patterns in ERROR_PATTERNS.items():
        if any(p.lower() in error_message.lower() for p in patterns):
            return error_type
    return "other"


@router.get("/errors", response_class=HTMLResponse)
async def errors_page(
    request: Request,
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    error_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1)
):
    """Error monitoring page."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    supabase = get_supabase()
    central_tz = get_admin_tz(request)
    utc_tz = ZoneInfo("UTC")
    per_page = 50
    offset = (page - 1) * per_page

    # Calculate stats
    stats = {"failed_24h": 0, "failed_7d": 0, "failure_rate": 0.0, "total_sent_24h": 0}
    error_types = {}

    try:
        yesterday = datetime.utcnow() - timedelta(hours=24)
        week_ago = datetime.utcnow() - timedelta(days=7)

        # Failed 24h
        failed_24h = supabase.table("scheduled_messages").select("id, error_message", count="exact").eq("status", "failed").gte("created_at", yesterday.isoformat()).execute()
        stats["failed_24h"] = failed_24h.count or 0

        # Count error types
        for msg in failed_24h.data or []:
            etype = classify_error(msg.get("error_message", ""))
            error_types[etype] = error_types.get(etype, 0) + 1

        # Failed 7d
        failed_7d = supabase.table("scheduled_messages").select("id", count="exact").eq("status", "failed").gte("created_at", week_ago.isoformat()).execute()
        stats["failed_7d"] = failed_7d.count or 0

        # Sent 24h
        sent_24h = supabase.table("scheduled_messages").select("id", count="exact").eq("status", "sent").gte("sent_at", yesterday.isoformat()).execute()
        stats["total_sent_24h"] = sent_24h.count or 0

        # Failure rate
        total_24h = stats["failed_24h"] + stats["total_sent_24h"]
        if total_24h > 0:
            stats["failure_rate"] = (stats["failed_24h"] / total_24h) * 100

    except Exception as e:
        logger.error(f"Error calculating error stats: {e}")

    # Get failed messages
    errors = []
    total_count = 0

    try:
        query = supabase.table("scheduled_messages").select("*", count="exact").eq("status", "failed")

        if date_from:
            query = query.gte("created_at", f"{date_from}T00:00:00")
        if date_to:
            query = query.lte("created_at", f"{date_to}T23:59:59")

        if error_type:
            # Must fetch all and filter in Python since error_type is derived
            result = query.order("created_at", desc=True).execute()
            filtered_data = [m for m in (result.data or []) if classify_error(m.get("error_message", "")) == error_type]
            total_count = len(filtered_data)
            paginated = filtered_data[offset:offset + per_page]
        else:
            # No derived filter — paginate at DB level
            total_result = query.execute()
            total_count = total_result.count or 0
            paginated_result = query.order("created_at", desc=True).range(offset, offset + per_page - 1).execute()
            paginated = paginated_result.data or []

        # Batch-fetch user names for visible page only
        user_ids = list(set(msg["user_id"] for msg in paginated))
        names = {}
        if user_ids:
            profiles = supabase.table("profiles").select("user_id, name").in_("user_id", user_ids).execute()
            names = {p["user_id"]: p["name"] for p in profiles.data or []}

        for msg in paginated:
            scheduled_utc = datetime.fromisoformat(msg["scheduled_time"].replace("Z", "+00:00"))
            if scheduled_utc.tzinfo is None:
                scheduled_utc = scheduled_utc.replace(tzinfo=utc_tz)
            scheduled_local = scheduled_utc.astimezone(central_tz)

            errors.append({
                "id": msg["id"],
                "user_id": msg["user_id"],
                "name": names.get(msg["user_id"], "Unknown"),
                "phone_number": msg["phone_number"],
                "scheduled_local": scheduled_local.strftime("%m/%d/%Y %I:%M %p"),
                "error_message": msg.get("error_message"),
                "error_type": classify_error(msg.get("error_message", ""))
            })

    except Exception as e:
        logger.error(f"Error fetching failed messages: {e}", exc_info=True)

    total_pages = (total_count + per_page - 1) // per_page if total_count > 0 else 1

    return templates.TemplateResponse("errors.html", {
        "request": request,
        "authenticated": True,
        "active_page": "errors",
        "errors": errors,
        "stats": stats,
        "error_types": error_types,
        "date_from": date_from,
        "date_to": date_to,
        "filter_error_type": error_type,
        "page": page,
        "total_pages": total_pages
    })


@router.post("/errors/{message_id}/retry")
async def retry_failed_message(request: Request, message_id: int):
    """Retry a failed message."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        supabase = get_supabase()

        # Reset to pending with new scheduled time
        supabase.table("scheduled_messages").update({
            "status": "pending",
            "scheduled_time": datetime.utcnow().isoformat(),
            "error_message": None
        }).eq("id", message_id).eq("status", "failed").execute()

        logger.info(f"Admin retried message {message_id}")

    except Exception as e:
        logger.error(f"Error retrying message: {e}")

    return RedirectResponse(url="/admin/errors", status_code=303)


@router.post("/errors/retry-all")
async def retry_all_failed(request: Request):
    """Retry all failed messages from last 24 hours."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    try:
        supabase = get_supabase()
        yesterday = datetime.utcnow() - timedelta(hours=24)

        # Batch update all failed messages from last 24h in a single query
        result = supabase.table("scheduled_messages").update({
            "status": "pending",
            "scheduled_time": datetime.utcnow().isoformat(),
            "error_message": None
        }).eq("status", "failed").gte("created_at", yesterday.isoformat()).execute()

        count = len(result.data) if result.data else 0
        logger.info(f"Admin retried {count} failed messages")

    except Exception as e:
        logger.error(f"Error retrying all messages: {e}")

    return RedirectResponse(url="/admin/errors", status_code=303)


# =============================================================================
# Prompt Management
# =============================================================================

PROMPT_DESCRIPTIONS = {
    # AI Prompts
    "coach_agent": "Main coaching response prompt - used when user sends a message",
    "sms_agent": "SMS tool-calling agent prompt - handles inbound texts with workout tools",
    "plan_generator": "Workout plan generation prompt - creates personalized weekly plans from profile",
    "plan_chat": "Plan modification chat prompt - handles interactive plan adjustments",
    # Message Templates
    "daily_message": "Legacy daily message template (deprecated)",
    "daily_workout": "Daily workout message template - sent at user's preferred time",
    "daily_rest": "Daily rest day message template - sent on rest days",
    "first_message": "First message intro template - sent when user texts for the first time (use --- to separate messages)",
    "first_workout": "First workout template - sent with intro if today is a workout day. Variables: {name}, {text_time}, {focus}, {exercises}, {tracking_url}",
    "first_rest_day": "First rest day template - sent with intro if today is a rest day. Variables: {name}, {text_time}",
}

# Fallback type classification if not in database
PROMPT_TYPES = {
    "coach_agent": "prompt",
    "sms_agent": "prompt",
    "plan_generator": "prompt",
    "plan_chat": "prompt",
    "daily_message": "template",
    "daily_workout": "template",
    "daily_rest": "template",
    "first_message": "template",
    "first_workout": "template",
    "first_rest_day": "template",
}


@router.get("/prompts", response_class=HTMLResponse)
async def prompts_page(request: Request):
    """List all prompts and templates."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    from app.prompts.loader import list_prompts

    prompts = []
    flash_message = request.query_params.get("flash")
    flash_type = request.query_params.get("type", "success")

    try:
        # Get all prompts from database
        db_prompts = list_prompts()

        for p in db_prompts:
            # Get type from database, fallback to PROMPT_TYPES dict
            prompt_type = p.get("type") or PROMPT_TYPES.get(p["name"], "prompt")
            prompts.append({
                "name": p["name"],
                "description": PROMPT_DESCRIPTIONS.get(p["name"], "Custom prompt/template"),
                "type": prompt_type,
                "version": p["version"],
                "model": p.get("model", "gpt-4o-mini"),
                "char_count": p["char_count"],
                "updated_at": p["updated_at"][:10] if p.get("updated_at") else None
            })

    except Exception as e:
        logger.error(f"Error loading prompts: {e}")

    return templates.TemplateResponse("prompts.html", {
        "request": request,
        "authenticated": True,
        "active_page": "prompts",
        "prompts": prompts,
        "flash_message": flash_message,
        "flash_type": flash_type
    })


@router.get("/prompts/{prompt_name}", response_class=HTMLResponse)
async def prompt_detail(request: Request, prompt_name: str):
    """View/edit a prompt or template."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    from app.prompts.loader import get_prompt, get_prompt_info, get_draft

    flash_message = request.query_params.get("flash")
    flash_type = request.query_params.get("type", "success")

    try:
        content = get_prompt(prompt_name, use_cache=False)
        prompt_info = get_prompt_info(prompt_name)
        draft = get_draft(prompt_name)

        # Add type info - from database or fallback to PROMPT_TYPES dict
        if prompt_info:
            prompt_info["type"] = prompt_info.get("type") or PROMPT_TYPES.get(prompt_name, "prompt")
    except ValueError:
        return RedirectResponse(url="/admin/prompts?flash=Prompt not found&type=error", status_code=303)

    return templates.TemplateResponse("prompt_detail.html", {
        "request": request,
        "authenticated": True,
        "active_page": "prompts",
        "prompt_name": prompt_name,
        "content": content,
        "prompt_info": prompt_info,
        "draft": draft,
        "flash_message": flash_message,
        "flash_type": flash_type
    })


@router.post("/prompts/{prompt_name}")
async def save_prompt_route(
    request: Request,
    prompt_name: str,
    content: str = Form(...),
    model: str = Form("gpt-4o-mini")
):
    """Save a prompt to the database (creates new version)."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    from app.prompts.loader import save_prompt

    try:
        new_version = save_prompt(prompt_name, content, model=model)
        logger.info(f"Admin saved prompt '{prompt_name}' as version {new_version} with model {model}")
        return RedirectResponse(
            url=f"/admin/prompts/{prompt_name}?flash=Saved as version {new_version}&type=success",
            status_code=303
        )
    except Exception as e:
        logger.error(f"Error saving prompt: {e}")
        return RedirectResponse(
            url=f"/admin/prompts/{prompt_name}?flash=Error: {e}&type=error",
            status_code=303
        )


# -----------------------------------------------------------------------------
# Version History Routes
# -----------------------------------------------------------------------------

@router.get("/prompts/{prompt_name}/history", response_class=HTMLResponse)
async def prompt_history(request: Request, prompt_name: str):
    """View version history for a prompt."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    from app.prompts.loader import get_prompt_history, get_prompt_info

    flash_message = request.query_params.get("flash")
    flash_type = request.query_params.get("type", "success")

    try:
        prompt_info = get_prompt_info(prompt_name)
        if not prompt_info:
            return RedirectResponse(url="/admin/prompts?flash=Prompt not found&type=error", status_code=303)

        history = get_prompt_history(prompt_name)

    except Exception as e:
        logger.error(f"Error loading prompt history: {e}")
        return RedirectResponse(url="/admin/prompts?flash=Error loading history&type=error", status_code=303)

    return templates.TemplateResponse("prompt_history.html", {
        "request": request,
        "authenticated": True,
        "active_page": "prompts",
        "prompt_name": prompt_name,
        "current_version": prompt_info["version"],
        "current_updated_at": prompt_info.get("updated_at"),
        "current_char_count": prompt_info.get("char_count"),
        "history": history,
        "flash_message": flash_message,
        "flash_type": flash_type
    })


@router.get("/prompts/{prompt_name}/version/{version}", response_class=HTMLResponse)
async def prompt_version_view(request: Request, prompt_name: str, version: int):
    """View a specific version of a prompt."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    from app.prompts.loader import get_prompt_version, get_prompt_info

    try:
        prompt_info = get_prompt_info(prompt_name)
        if not prompt_info:
            return RedirectResponse(url="/admin/prompts?flash=Prompt not found&type=error", status_code=303)

        version_data = get_prompt_version(prompt_name, version)
        if not version_data:
            return RedirectResponse(
                url=f"/admin/prompts/{prompt_name}/history?flash=Version not found&type=error",
                status_code=303
            )

    except Exception as e:
        logger.error(f"Error loading prompt version: {e}")
        return RedirectResponse(url="/admin/prompts?flash=Error loading version&type=error", status_code=303)

    return templates.TemplateResponse("prompt_version.html", {
        "request": request,
        "authenticated": True,
        "active_page": "prompts",
        "prompt_name": prompt_name,
        "version": version,
        "version_data": version_data,
        "current_version": prompt_info["version"]
    })


@router.get("/prompts/{prompt_name}/diff", response_class=HTMLResponse)
async def prompt_diff(request: Request, prompt_name: str, v1: int = Query(...), v2: int = Query(...)):
    """Compare two versions of a prompt."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    from app.prompts.loader import get_prompt_version, get_current_prompt_version, get_prompt_info
    from app.prompts.diff_utils import generate_side_by_side_diff, get_diff_stats

    try:
        prompt_info = get_prompt_info(prompt_name)
        if not prompt_info:
            return RedirectResponse(url="/admin/prompts?flash=Prompt not found&type=error", status_code=303)

        current_version = prompt_info["version"]

        # Get version 1 content
        if v1 == current_version:
            v1_data = get_current_prompt_version(prompt_name)
        else:
            v1_data = get_prompt_version(prompt_name, v1)

        # Get version 2 content
        if v2 == current_version:
            v2_data = get_current_prompt_version(prompt_name)
        else:
            v2_data = get_prompt_version(prompt_name, v2)

        if not v1_data or not v2_data:
            return RedirectResponse(
                url=f"/admin/prompts/{prompt_name}/history?flash=Version not found&type=error",
                status_code=303
            )

        # Generate diff
        diff_lines = generate_side_by_side_diff(v1_data["prompt_text"], v2_data["prompt_text"])
        diff_stats = get_diff_stats(v1_data["prompt_text"], v2_data["prompt_text"])

    except Exception as e:
        logger.error(f"Error generating diff: {e}")
        return RedirectResponse(
            url=f"/admin/prompts/{prompt_name}/history?flash=Error generating diff&type=error",
            status_code=303
        )

    return templates.TemplateResponse("prompt_diff.html", {
        "request": request,
        "authenticated": True,
        "active_page": "prompts",
        "prompt_name": prompt_name,
        "v1": v1,
        "v2": v2,
        "v1_data": v1_data,
        "v2_data": v2_data,
        "diff_lines": diff_lines,
        "diff_stats": diff_stats,
        "current_version": current_version
    })


@router.post("/prompts/{prompt_name}/restore/{version}")
async def restore_prompt_version(request: Request, prompt_name: str, version: int):
    """Restore a previous version of a prompt."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    from app.prompts.loader import restore_prompt_version as do_restore

    try:
        new_version = do_restore(prompt_name, version)
        logger.info(f"Admin restored prompt '{prompt_name}' from version {version} to version {new_version}")
        return RedirectResponse(
            url=f"/admin/prompts/{prompt_name}?flash=Restored version {version} as version {new_version}&type=success",
            status_code=303
        )
    except Exception as e:
        logger.error(f"Error restoring prompt version: {e}")
        return RedirectResponse(
            url=f"/admin/prompts/{prompt_name}/history?flash=Error: {e}&type=error",
            status_code=303
        )


# -----------------------------------------------------------------------------
# Draft Auto-save Routes (AJAX)
# -----------------------------------------------------------------------------

from fastapi.responses import JSONResponse

@router.post("/prompts/{prompt_name}/draft")
async def save_draft_route(request: Request, prompt_name: str):
    """Auto-save draft (AJAX endpoint)."""
    if not is_authenticated(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    from app.prompts.loader import save_draft

    try:
        body = await request.json()
        draft_text = body.get("draft_text", "")

        if save_draft(prompt_name, draft_text):
            return JSONResponse({"success": True, "message": "Draft saved"})
        else:
            return JSONResponse({"success": False, "message": "Failed to save draft"}, status_code=500)
    except Exception as e:
        logger.error(f"Error saving draft: {e}")
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@router.delete("/prompts/{prompt_name}/draft")
async def clear_draft_route(request: Request, prompt_name: str):
    """Clear draft (AJAX endpoint)."""
    if not is_authenticated(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    from app.prompts.loader import clear_draft

    try:
        clear_draft(prompt_name)
        return JSONResponse({"success": True, "message": "Draft cleared"})
    except Exception as e:
        logger.error(f"Error clearing draft: {e}")
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)


@router.get("/prompts/{prompt_name}/draft")
async def get_draft_route(request: Request, prompt_name: str):
    """Get current draft (AJAX endpoint)."""
    if not is_authenticated(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    from app.prompts.loader import get_draft

    try:
        draft = get_draft(prompt_name)
        if draft:
            return JSONResponse({
                "has_draft": True,
                "draft_text": draft["draft_text"],
                "updated_at": draft["updated_at"]
            })
        else:
            return JSONResponse({"has_draft": False})
    except Exception as e:
        logger.error(f"Error getting draft: {e}")
        return JSONResponse({"has_draft": False, "error": str(e)})


# =============================================================================
# Debug / Prompt Testing
# =============================================================================


def _get_debug_users_dropdown(supabase) -> list:
    """Fetch all users for debug page dropdown (shared across debug routes)."""
    try:
        profiles = supabase.table("profiles").select("user_id, name, phone").order("name").execute()
        return [
            {"id": p["user_id"], "name": p.get("name", "Unknown"), "phone_number": p.get("phone", "")}
            for p in (profiles.data or [])
        ]
    except Exception as e:
        logger.error(f"Error fetching users for debug: {e}")
        return []


def _load_debug_user_context(supabase, user_id: str) -> tuple:
    """Load user, profile, and recent messages for debug pages.
    Returns (selected_user, profile, recent_messages).
    """
    selected_user = None
    profile = None
    recent_messages = []

    try:
        user_result = supabase.table("users").select("*").eq("id", user_id).execute()
        if user_result.data:
            selected_user = user_result.data[0]
            selected_user["name"] = "Unknown"

        profile_result = supabase.table("profiles").select("*").eq("user_id", user_id).execute()
        if profile_result.data:
            profile = profile_result.data[0]
            if selected_user:
                selected_user["name"] = profile.get("name", "Unknown")
                selected_user["phone_number"] = profile.get("phone", "")

        messages_result = supabase.table("messages").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(10).execute()
        recent_messages = messages_result.data or []

    except Exception as e:
        logger.error(f"Error loading user context for debug: {e}")

    return selected_user, profile, recent_messages


@router.get("/debug", response_class=HTMLResponse)
async def debug_page(request: Request, user_id: Optional[str] = Query(None)):
    """Debug page for testing prompts with real user data."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    supabase = get_supabase()
    users = _get_debug_users_dropdown(supabase)

    selected_user = None
    profile = None
    recent_messages = []
    workout_summary = None

    if user_id:
        selected_user, profile, recent_messages = _load_debug_user_context(supabase, user_id)
        workout_summary = "No workout scheduled"

    return templates.TemplateResponse("debug.html", {
        "request": request,
        "authenticated": True,
        "active_page": "debug",
        "users": users,
        "selected_user": selected_user,
        "profile": profile,
        "recent_messages": recent_messages,
        "workout_summary": workout_summary,
        "test_message": None,
        "filled_prompt": None
    })


@router.post("/debug/preview")
async def debug_preview(
    request: Request,
    user_id: str = Form(...),
    test_message: str = Form(...)
):
    """Generate a preview of the prompt with user data."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    supabase = get_supabase()
    users = _get_debug_users_dropdown(supabase)

    selected_user, profile, recent_messages = _load_debug_user_context(supabase, user_id)
    workout_summary = "No workout scheduled"
    workout_today = None
    filled_prompt = ""

    try:
        # Get today's workout
        from app.db.queries import get_user_workout_plan
        from app.services.ai_agent import get_ai_agent

        workout_plan = get_user_workout_plan(user_id)
        if workout_plan:
            plan_data = workout_plan.get("plan_data", {})
            # Use user's timezone to determine today
            user_tz_str = profile.get("timezone", DEFAULT_TIMEZONE) if profile else DEFAULT_TIMEZONE
            try:
                user_tz = ZoneInfo(user_tz_str)
            except Exception:
                user_tz = ZoneInfo(DEFAULT_TIMEZONE)
            today = datetime.now(user_tz).strftime("%A")
            # Find today's workout
            if "workouts" in plan_data:
                for workout in plan_data["workouts"]:
                    if workout.get("day") == today:
                        workout_today = workout
                        break

        # Get workout summary using AI agent's method
        ai_agent = get_ai_agent()
        workout_summary = ai_agent._summarize_workout(workout_today)

        # Build the AI context and fill the prompt
        from app.prompts.loader import get_prompt
        from app.db.models import AIContext

        prompt_template = get_prompt("coach_agent", use_cache=False)

        # Create AIContext
        context = AIContext(
            user_id=user_id,
            user_name=profile.get("name", "there") if profile else "there",
            phone_number=profile.get("phone", "") if profile else "",
            goal=profile.get("goal", "general fitness") if profile else "general fitness",
            experience=profile.get("experience") if profile else None,
            equipment=profile.get("equipment", []) if profile else [],
            split=profile.get("split") if profile else None,
            workout_today=workout_today,
            recent_messages=[
                {"direction": m["direction"], "content": m["content"]}
                for m in reversed(recent_messages)
            ],
            incoming_message=test_message
        )

        # Fill the template manually (same logic as ai_agent)
        recent_msgs = "\n".join([
            f"{'User' if msg['direction'] == 'inbound' else 'Brandon'}: {msg['content']}"
            for msg in context.recent_messages[-10:]
        ])

        # Get the new context fields for prompt filling
        from app.db.queries import get_recent_workout_history, get_workout_performance_history

        workout_history = get_recent_workout_history(user_id, days=7)
        full_workout_plan_data = None
        if workout_plan:
            plan_data = workout_plan.get("plan_data", {})
            if isinstance(plan_data, dict):
                full_workout_plan_data = plan_data.get("workouts", [])

        workout_performance_history = get_workout_performance_history(user_id, today, limit=4)

        # Use AI agent's summary functions
        workout_history_str = ai_agent._summarize_workout_history(workout_history)
        full_workout_plan_str = ai_agent._summarize_full_plan(full_workout_plan_data)
        workout_performance_history_str = ai_agent._summarize_workout_performance(workout_performance_history)

        filled_prompt = prompt_template.format(
            user_name=context.user_name,
            phone_number=context.phone_number,
            goal=context.goal,
            experience=context.experience or "beginner",
            equipment=", ".join(context.equipment) if context.equipment else "no equipment",
            split=context.split or "full body",
            workout_today=workout_summary,
            recent_messages=recent_msgs or "No recent messages",
            incoming_message=context.incoming_message,
            workout_history=workout_history_str,
            full_workout_plan=full_workout_plan_str,
            workout_performance_history=workout_performance_history_str
        )

    except Exception as e:
        logger.error(f"Error generating preview: {e}", exc_info=True)
        filled_prompt = f"Error generating preview: {e}"

    return templates.TemplateResponse("debug.html", {
        "request": request,
        "authenticated": True,
        "active_page": "debug",
        "users": users,
        "selected_user": selected_user,
        "profile": profile,
        "recent_messages": recent_messages,
        "workout_summary": workout_summary,
        "test_message": test_message,
        "filled_prompt": filled_prompt,
        "generated_response": None,
        "generation_stats": None
    })


@router.post("/debug/generate")
async def debug_generate(
    request: Request,
    user_id: str = Form(...),
    test_message: str = Form(...)
):
    """Generate an AI response for testing (not sent)."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    import time
    supabase = get_supabase()
    users = _get_debug_users_dropdown(supabase)

    selected_user, profile, recent_messages = _load_debug_user_context(supabase, user_id)
    workout_summary = "No workout scheduled"
    workout_today = None
    filled_prompt = ""
    generated_response = None
    generation_stats = None

    try:
        # Get today's workout
        from app.db.queries import get_user_workout_plan
        from app.prompts.loader import get_prompt
        from app.db.models import AIContext
        from app.services.ai_agent import get_ai_agent

        workout_plan = get_user_workout_plan(user_id)
        if workout_plan:
            plan_data = workout_plan.get("plan_data", {})
            # Use user's timezone to determine today
            user_tz_str = profile.get("timezone", DEFAULT_TIMEZONE) if profile else DEFAULT_TIMEZONE
            try:
                user_tz = ZoneInfo(user_tz_str)
            except Exception:
                user_tz = ZoneInfo(DEFAULT_TIMEZONE)
            today = datetime.now(user_tz).strftime("%A")
            # Find today's workout
            if "workouts" in plan_data:
                for workout in plan_data["workouts"]:
                    if workout.get("day") == today:
                        workout_today = workout
                        break

        # Get workout summary using AI agent's method
        ai_agent = get_ai_agent()
        workout_summary = ai_agent._summarize_workout(workout_today)

        prompt_template = get_prompt("coach_agent", use_cache=False)

        # Create AIContext
        context = AIContext(
            user_id=user_id,
            user_name=profile.get("name", "there") if profile else "there",
            phone_number=profile.get("phone", "") if profile else "",
            goal=profile.get("goal", "general fitness") if profile else "general fitness",
            experience=profile.get("experience") if profile else None,
            equipment=profile.get("equipment", []) if profile else [],
            split=profile.get("split") if profile else None,
            workout_today=workout_today,
            recent_messages=[
                {"direction": m["direction"], "content": m["content"]}
                for m in reversed(recent_messages)
            ],
            incoming_message=test_message
        )

        # Fill the template for display
        recent_msgs = "\n".join([
            f"{'User' if msg['direction'] == 'inbound' else 'Brandon'}: {msg['content']}"
            for msg in context.recent_messages[-10:]
        ])

        # Get the new context fields for prompt filling
        from app.db.queries import get_recent_workout_history, get_workout_performance_history

        workout_history = get_recent_workout_history(user_id, days=7)
        full_workout_plan_data = None
        if workout_plan:
            plan_data_inner = workout_plan.get("plan_data", {})
            if isinstance(plan_data_inner, dict):
                full_workout_plan_data = plan_data_inner.get("workouts", [])

        workout_performance_history = get_workout_performance_history(user_id, today, limit=4)

        # Use AI agent's summary functions
        workout_history_str = ai_agent._summarize_workout_history(workout_history)
        full_workout_plan_str = ai_agent._summarize_full_plan(full_workout_plan_data)
        workout_performance_history_str = ai_agent._summarize_workout_performance(workout_performance_history)

        # Add new context fields to AIContext for generate_response
        context.workout_history = workout_history
        context.full_workout_plan = full_workout_plan_data
        context.workout_performance_history = workout_performance_history

        filled_prompt = prompt_template.format(
            user_name=context.user_name,
            phone_number=context.phone_number,
            goal=context.goal,
            experience=context.experience or "beginner",
            equipment=", ".join(context.equipment) if context.equipment else "no equipment",
            split=context.split or "full body",
            workout_today=workout_summary,
            recent_messages=recent_msgs or "No recent messages",
            incoming_message=context.incoming_message,
            workout_history=workout_history_str,
            full_workout_plan=full_workout_plan_str,
            workout_performance_history=workout_performance_history_str
        )

        # Generate the AI response
        start_time = time.time()

        generated_response = await ai_agent.generate_response(
            prompt_template=prompt_template,
            context=context
        )

        latency_ms = int((time.time() - start_time) * 1000)

        # Estimate token counts (rough approximation)
        generation_stats = {
            "prompt_tokens": len(filled_prompt) // 4,
            "completion_tokens": len(generated_response) // 4,
            "total_tokens": (len(filled_prompt) + len(generated_response)) // 4,
            "latency_ms": latency_ms
        }

    except Exception as e:
        logger.error(f"Error generating response: {e}", exc_info=True)
        filled_prompt = f"Error: {e}"

    return templates.TemplateResponse("debug.html", {
        "request": request,
        "authenticated": True,
        "active_page": "debug",
        "users": users,
        "selected_user": selected_user,
        "profile": profile,
        "recent_messages": recent_messages,
        "workout_summary": workout_summary,
        "test_message": test_message,
        "filled_prompt": filled_prompt,
        "generated_response": generated_response,
        "generation_stats": generation_stats
    })


@router.post("/debug/generate-plan")
async def debug_generate_plan(request: Request):
    """Generate a workout plan for testing (admin debug tool)."""
    if not is_authenticated(request):
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})

    import json
    import time

    try:
        data = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON"})

    # Extract profile data
    profile = {
        "name": data.get("name", "User"),
        "age": data.get("age"),
        "sex": data.get("sex"),
        "goal": data.get("goal", "general fitness"),
        "experience": data.get("experience"),
        "equipment": data.get("equipment", []),
        "split": data.get("split"),
        "workoutDays": data.get("workoutDays", []),
        "notes": data.get("notes")
    }

    try:
        from app.prompts.loader import get_prompt_with_model
        from app.services.ai_agent import get_ai_agent

        # Load prompt and model
        prompt_template, model = get_prompt_with_model("plan_generator")
        logger.info(f"Debug plan generation - using model: {model}")

        # Generate plan
        ai_agent = get_ai_agent()
        start_time = time.time()

        logger.info(f"Calling ai_agent.generate_plan with model={model}")
        response_text = await ai_agent.generate_plan(
            prompt_template=prompt_template,
            profile=profile,
            model=model
        )

        latency_ms = int((time.time() - start_time) * 1000)

        # Parse JSON response
        try:
            plan_data = json.loads(response_text)
        except json.JSONDecodeError:
            return JSONResponse(status_code=500, content={
                "error": "AI generated invalid JSON",
                "raw": response_text[:500]
            })

        # Handle wrapped response
        if "plan" in plan_data and "workouts" not in plan_data:
            plan_data = plan_data["plan"]

        logger.info(f"Debug plan generated in {latency_ms}ms with model {model}")

        return JSONResponse(content={
            "plan": plan_data,
            "model": model,
            "latency_ms": latency_ms
        })

    except Exception as e:
        logger.error(f"Error generating plan in debug: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"error": str(e)})


# =============================================================================
# Today's Workouts View
# =============================================================================

@router.get("/workouts-today", response_class=HTMLResponse)
async def workouts_today(
    request: Request,
    date: Optional[str] = Query(None),
    history_page: int = Query(1, ge=1)
):
    """Today's workouts dashboard showing all users' workout status."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    supabase = get_supabase()
    central_tz = get_admin_tz(request)
    utc_tz = ZoneInfo("UTC")

    # Get current time in Central
    now_central = datetime.now(central_tz)

    # Parse selected date or default to today
    if date:
        try:
            selected_date = datetime.strptime(date, "%Y-%m-%d")
            selected_date = selected_date.replace(tzinfo=central_tz)
        except ValueError:
            selected_date = now_central
    else:
        selected_date = now_central

    selected_str = selected_date.strftime("%Y-%m-%d")
    selected_day_name = selected_date.strftime("%A")
    is_today = selected_str == now_central.strftime("%Y-%m-%d")

    # Calculate prev/next dates
    prev_date = (selected_date - timedelta(days=1)).strftime("%Y-%m-%d")
    next_date = (selected_date + timedelta(days=1)).strftime("%Y-%m-%d")

    # Initialize result containers
    workouts_completed = []
    workouts_in_progress = []
    workouts_pending = []
    rest_day_users = []

    stats = {
        "total_scheduled": 0,
        "completed": 0,
        "in_progress": 0,
        "pending": 0,
        "rest_day": 0
    }

    # Workout history pagination
    history_per_page = 10
    history_offset = (history_page - 1) * history_per_page
    recent_workouts = []
    history_total = 0
    history_total_pages = 1

    try:
        # Get all active users with profiles
        profiles_result = supabase.table("profiles").select(
            "user_id, name, phone, timezone"
        ).execute()
        profiles_by_id = {p["user_id"]: p for p in (profiles_result.data or [])}

        # Get all active workout plans
        plans_result = supabase.table("workout_plans").select(
            "user_id, plan_data"
        ).eq("status", "active").execute()
        plans_by_user = {p["user_id"]: p for p in (plans_result.data or [])}

        # Get selected day's workout sessions (this is the source of truth for activity)
        # Use filter with explicit operators to match timestamps on the selected date
        # Database stores as "2026-01-23 00:00:00" format
        date_start = f"{selected_str} 00:00:00"
        date_end = f"{selected_str} 23:59:59"
        sessions_result = supabase.table("workout_sessions").select("*").filter(
            "workout_date", "gte", date_start
        ).filter(
            "workout_date", "lte", date_end
        ).execute()

        logger.info(f"Workouts query for {selected_str} ({date_start} to {date_end}): found {len(sessions_result.data or [])} sessions")

        sessions_by_user = {}
        session_ids = []
        for session in (sessions_result.data or []):
            user_id = session.get("user_id")
            if user_id:
                sessions_by_user[user_id] = session
                if session.get("id"):
                    session_ids.append(session["id"])

        # Get workout sets for all sessions to calculate metrics
        sets_by_session = {}
        if session_ids:
            sets_result = supabase.table("workout_sets").select("*").in_(
                "session_id", session_ids
            ).execute()
            for s in (sets_result.data or []):
                sid = s.get("session_id")
                if sid not in sets_by_session:
                    sets_by_session[sid] = []
                sets_by_session[sid].append(s)

        # Track users we've processed (from sessions)
        processed_users = set()

        # FIRST: Process all users who have sessions on this day (source of truth)
        for user_id, session in sessions_by_user.items():
            processed_users.add(user_id)
            profile = profiles_by_id.get(user_id, {})

            user_info = {
                "user_id": user_id,
                "name": profile.get("name", "Unknown"),
                "phone": profile.get("phone", ""),
            }

            status = session.get("status", "pending")
            workout_info = {
                **user_info,
                "focus": session.get("focus", "Workout"),
                "exercises": [],  # Get from plan if available
                "session": {
                    "id": session.get("id"),
                    "status": status,
                    "started_at": None,
                    "completed_at": None,
                    "duration_minutes": None
                }
            }

            # Try to get exercises from the user's plan
            plan = plans_by_user.get(user_id)
            if plan:
                plan_data = plan.get("plan_data", {})
                for workout in plan_data.get("workouts", []):
                    if workout.get("day") == session.get("day_name"):
                        workout_info["exercises"] = workout.get("exercises", [])
                        break

            # Parse timestamps
            if session.get("started_at"):
                started_utc = datetime.fromisoformat(session["started_at"].replace("Z", "+00:00"))
                if started_utc.tzinfo is None:
                    started_utc = started_utc.replace(tzinfo=utc_tz)
                started_local = started_utc.astimezone(central_tz)
                workout_info["session"]["started_at"] = started_local.strftime("%I:%M %p")

            if session.get("completed_at"):
                completed_utc = datetime.fromisoformat(session["completed_at"].replace("Z", "+00:00"))
                if completed_utc.tzinfo is None:
                    completed_utc = completed_utc.replace(tzinfo=utc_tz)
                completed_local = completed_utc.astimezone(central_tz)
                workout_info["session"]["completed_at"] = completed_local.strftime("%I:%M %p")

                # Calculate duration
                if session.get("started_at"):
                    started_utc_for_duration = datetime.fromisoformat(session["started_at"].replace("Z", "+00:00"))
                    if started_utc_for_duration.tzinfo is None:
                        started_utc_for_duration = started_utc_for_duration.replace(tzinfo=utc_tz)
                    duration = completed_utc - started_utc_for_duration
                    workout_info["session"]["duration_minutes"] = int(duration.total_seconds() / 60)

            # Calculate workout metrics from sets data
            session_id = session.get("id")
            session_sets = sets_by_session.get(session_id, [])
            completed_sets = [s for s in session_sets if s.get("completed") == 1]

            total_sets = len(completed_sets)
            total_reps = sum(s.get("reps") or 0 for s in completed_sets)
            # Weight volume = sum of (weight * reps) for each set
            weight_volume = sum(
                (s.get("weight") or 0) * (s.get("reps") or 0)
                for s in completed_sets
            )

            workout_info["metrics"] = {
                "total_sets": total_sets,
                "total_reps": total_reps,
                "weight_volume": weight_volume,
                "exercises_logged": len(set(s.get("exercise_name") for s in completed_sets))
            }

            # Categorize by status
            stats["total_scheduled"] += 1
            if status == "completed":
                workouts_completed.append(workout_info)
                stats["completed"] += 1
            elif status == "in_progress":
                workouts_in_progress.append(workout_info)
                stats["in_progress"] += 1
            else:
                workouts_pending.append(workout_info)
                stats["pending"] += 1

        # SECOND: Process users with active plans who don't have sessions yet
        for user_id, plan in plans_by_user.items():
            if user_id in processed_users:
                continue  # Already processed from session

            profile = profiles_by_id.get(user_id)
            if not profile:
                continue

            plan_data = plan.get("plan_data", {})
            workouts = plan_data.get("workouts", [])

            # Find selected day's workout in the plan
            days_workout = None
            is_rest_day = True
            for workout in workouts:
                if workout.get("day") == selected_day_name:
                    days_workout = workout
                    is_rest_day = workout.get("rest_day", False)
                    break

            user_info = {
                "user_id": user_id,
                "name": profile.get("name", "Unknown"),
                "phone": profile.get("phone", ""),
            }

            if is_rest_day or days_workout is None:
                # User has a rest day
                rest_day_users.append(user_info)
                stats["rest_day"] += 1
            else:
                # User has a workout scheduled but no session yet = pending
                stats["total_scheduled"] += 1
                stats["pending"] += 1
                workouts_pending.append({
                    **user_info,
                    "focus": days_workout.get("focus", "Workout"),
                    "exercises": days_workout.get("exercises", []),
                    "session": None
                })

        # Sort lists by name
        workouts_completed.sort(key=lambda x: x["name"].lower())
        workouts_in_progress.sort(key=lambda x: x["name"].lower())
        workouts_pending.sort(key=lambda x: x["name"].lower())
        rest_day_users.sort(key=lambda x: x["name"].lower())

        # ----- Workout History (all completed workouts, paginated) -----
        # Get total count of completed workouts
        count_result = supabase.table("workout_sessions").select(
            "id", count="exact"
        ).eq("status", "completed").execute()
        history_total = count_result.count if count_result.count else 0
        history_total_pages = max(1, (history_total + history_per_page - 1) // history_per_page)

        # Get paginated completed workouts
        history_result = supabase.table("workout_sessions").select("*").eq(
            "status", "completed"
        ).order("completed_at", desc=True).range(
            history_offset, history_offset + history_per_page - 1
        ).execute()

        for session in (history_result.data or []):
            user_id = session.get("user_id")
            profile = profiles_by_id.get(user_id, {})

            # Parse completed_at timestamp
            completed_display = "—"
            date_display = "—"
            if session.get("completed_at"):
                completed_utc = datetime.fromisoformat(session["completed_at"].replace("Z", "+00:00"))
                if completed_utc.tzinfo is None:
                    completed_utc = completed_utc.replace(tzinfo=utc_tz)
                completed_local = completed_utc.astimezone(central_tz)
                completed_display = completed_local.strftime("%I:%M %p")
                date_display = completed_local.strftime("%b %d, %Y")

            # Calculate duration
            duration_minutes = None
            if session.get("started_at") and session.get("completed_at"):
                started_utc = datetime.fromisoformat(session["started_at"].replace("Z", "+00:00"))
                if started_utc.tzinfo is None:
                    started_utc = started_utc.replace(tzinfo=utc_tz)
                completed_utc_calc = datetime.fromisoformat(session["completed_at"].replace("Z", "+00:00"))
                if completed_utc_calc.tzinfo is None:
                    completed_utc_calc = completed_utc_calc.replace(tzinfo=utc_tz)
                duration = completed_utc_calc - started_utc
                duration_minutes = int(duration.total_seconds() / 60)

            recent_workouts.append({
                "user_id": user_id,
                "name": profile.get("name", "Unknown"),
                "focus": session.get("focus", "Workout"),
                "day_name": session.get("day_name", ""),
                "date_display": date_display,
                "completed_at": completed_display,
                "duration_minutes": duration_minutes,
                "workout_date": session.get("workout_date", "")[:10] if session.get("workout_date") else ""
            })

    except Exception as e:
        logger.error(f"Error fetching workouts: {e}", exc_info=True)

    return templates.TemplateResponse("workouts_today.html", {
        "request": request,
        "authenticated": True,
        "active_page": "workouts-today",
        "selected_date": selected_str,
        "selected_date_display": selected_date.strftime("%A, %B %d"),
        "is_today": is_today,
        "prev_date": prev_date,
        "next_date": next_date,
        "stats": stats,
        "workouts_completed": workouts_completed,
        "workouts_in_progress": workouts_in_progress,
        "workouts_pending": workouts_pending,
        "rest_day_users": rest_day_users,
        "recent_workouts": recent_workouts,
        "history_page": history_page,
        "history_total": history_total,
        "history_total_pages": history_total_pages
    })


# =============================================================================
# Daily Message Testing
# =============================================================================

def _get_profiles_list(supabase) -> list:
    """Fetch profiles list for dropdown (shared across daily-test routes)."""
    try:
        profiles = supabase.table("profiles").select("user_id, name, phone").order("name").execute()
        return profiles.data or []
    except Exception as e:
        logger.error(f"Error fetching profiles: {e}")
        return []


def _format_daily_message_for_test(user_id: str, target_date: str) -> list[str]:
    """
    Generate a daily message using the same production code path.

    Args:
        user_id: User ID
        target_date: Date string (YYYY-MM-DD) to simulate

    Returns:
        List of message strings (one per text bubble, identical to production)
    """
    from scripts.send_scheduled_messages import format_daily_message

    supabase = get_supabase()

    # Build user_data and profile dicts matching what production expects
    user_resp = supabase.table("users").select("*").eq("id", user_id).execute()
    profile_resp = supabase.table("profiles").select("*").eq("user_id", user_id).execute()

    if not user_resp.data:
        return [f"Error: User {user_id} not found"]
    if not profile_resp.data:
        return [f"Error: Profile for {user_id} not found"]

    user_data = user_resp.data[0]
    profile = profile_resp.data[0]

    return format_daily_message(user_data, profile, target_date=target_date)


def get_workout_schedule(user_id: str) -> dict:
    """Get user's full weekly workout schedule."""
    from app.db.queries import get_user_workout_plan

    workout_plan = get_user_workout_plan(user_id)
    schedule = {}

    if workout_plan:
        plan_data = workout_plan.get("plan_data", {})
        if isinstance(plan_data, dict) and "workouts" in plan_data:
            for workout in plan_data["workouts"]:
                day = workout.get("day")
                if day:
                    schedule[day] = workout

    return schedule


@router.get("/daily-test", response_class=HTMLResponse)
async def daily_test_page(request: Request):
    """Daily message testing page."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    supabase = get_supabase()
    users = _get_profiles_list(supabase)

    admin_tz = get_admin_tz(request)
    today_date = datetime.now(admin_tz).strftime("%Y-%m-%d")

    return templates.TemplateResponse("daily_test.html", {
        "request": request,
        "authenticated": True,
        "active_page": "daily-test",
        "users": users,
        "selected_date": today_date,
        "selected_user_id": None,
        "selected_user_name": None,
        "preview_messages": None,
        "workout_schedule": None
    })


@router.post("/daily-test/preview")
async def daily_test_preview(
    request: Request,
    user_id: str = Form(...),
    target_date: str = Form(...),
):
    """Preview daily message for a user on a specific date using production code path."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    supabase = get_supabase()
    users = _get_profiles_list(supabase)

    user_name = "Unknown"
    for u in users:
        if u["user_id"] == user_id:
            user_name = u["name"]
            break

    message_parts = _format_daily_message_for_test(user_id, target_date)
    workout_schedule = get_workout_schedule(user_id)

    return templates.TemplateResponse("daily_test.html", {
        "request": request,
        "authenticated": True,
        "active_page": "daily-test",
        "users": users,
        "selected_date": target_date,
        "selected_user_id": user_id,
        "selected_user_name": user_name,
        "preview_messages": message_parts,
        "workout_schedule": workout_schedule
    })


@router.post("/daily-test/send")
async def daily_test_send(
    request: Request,
    user_id: str = Form(...),
    target_date: str = Form(...),
):
    """Send daily message to a user immediately using production code path."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    supabase = get_supabase()
    users = _get_profiles_list(supabase)

    user_name = "Unknown"
    phone_number = None
    for u in users:
        if u["user_id"] == user_id:
            user_name = u["name"]
            phone_number = u.get("phone")
            break

    # Generate message using the exact same production code path
    message_parts = _format_daily_message_for_test(user_id, target_date)
    workout_schedule = get_workout_schedule(user_id)

    send_success = False
    send_result = ""

    try:
        if not phone_number:
            raise ValueError("User has no phone number")

        from app.db.models import OutboundMessageChunk

        mac_client = MacServerClient()
        await mac_client.send_message(
            phone_number=phone_number,
            messages=[OutboundMessageChunk(text=part) for part in message_parts],
            delay_before_typing=1.0,
            typing_duration=2.0
        )

        send_success = True
        send_result = f"Message sent to {user_name} at {phone_number} ({len(message_parts)} bubble(s))"
        logger.info(f"Admin sent daily test message to {user_id} ({phone_number}) for {target_date}")

    except Exception as e:
        send_result = f"Failed to send: {e}"
        logger.error(f"Error sending daily test message: {e}")

    return templates.TemplateResponse("daily_test.html", {
        "request": request,
        "authenticated": True,
        "active_page": "daily-test",
        "users": users,
        "selected_date": target_date,
        "selected_user_id": user_id,
        "selected_user_name": user_name,
        "preview_messages": message_parts,
        "workout_schedule": workout_schedule,
        "send_success": send_success,
        "send_result": send_result
    })


# ---------------------------------------------------------------------------
# Agent Tester
# ---------------------------------------------------------------------------

@router.get("/agent-tester", response_class=HTMLResponse)
async def agent_tester_page(request: Request, user_id: Optional[str] = Query(None)):
    """Agent tester page — run the full agent loop and see a detailed trace."""
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)

    supabase = get_supabase()
    users = _get_debug_users_dropdown(supabase)

    selected_user = None
    profile = None
    recent_messages = []

    if user_id:
        selected_user, profile, recent_messages = _load_debug_user_context(supabase, user_id)

    return templates.TemplateResponse("agent_tester.html", {
        "request": request,
        "authenticated": True,
        "active_page": "agent-tester",
        "users": users,
        "selected_user": selected_user,
        "profile": profile,
        "recent_messages": recent_messages,
        "test_message": None,
        "trace": None,
    })


@router.post("/agent-tester/run")
async def agent_tester_run(
    request: Request,
    user_id: str = Form(...),
    test_message: str = Form(...),
):
    """Run the full agent loop and return a detailed trace."""
    if not is_authenticated(request):
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    from app.sms.agent import run_agent
    from app.db.models import UserProfile
    import json as _json

    supabase = get_supabase()
    users = _get_debug_users_dropdown(supabase)
    selected_user, profile_data, recent_messages = _load_debug_user_context(supabase, user_id)

    if not profile_data:
        return JSONResponse({"error": "User profile not found"}, status_code=404)

    # Build a UserProfile object from the dict (run_agent expects attribute access)
    profile = UserProfile(**profile_data)

    # Collect trace events
    trace = []

    def collect_event(event_type: str, data: dict):
        # Ensure all data is JSON-serializable
        safe_data = _json.loads(_json.dumps(data, default=str))
        trace.append({"type": event_type, **safe_data})

    try:
        response_text = await run_agent(
            user_id=user_id,
            phone_number=profile.phone or "",
            incoming_message=test_message,
            profile=profile,
            send_fn=None,  # Don't send anything — dry run
            on_event=collect_event,
        )
    except Exception as e:
        logger.error(f"Agent tester error: {e}", exc_info=True)
        trace.append({"type": "error", "message": str(e)})
        response_text = f"Error: {e}"

    return templates.TemplateResponse("agent_tester.html", {
        "request": request,
        "authenticated": True,
        "active_page": "agent-tester",
        "users": users,
        "selected_user": selected_user,
        "profile": profile_data,
        "recent_messages": recent_messages,
        "test_message": test_message,
        "trace": trace,
    })
