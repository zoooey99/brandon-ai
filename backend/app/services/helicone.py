"""
Helicone API client for fetching LLM usage analytics.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import httpx

from app.config import settings

logger = logging.getLogger(__name__)

HELICONE_API_URL = "https://api.helicone.ai/v1"


async def get_usage_stats(days: int = 7) -> Dict:
    """
    Fetch LLM usage stats from Helicone for the last N days.

    Returns:
        Dict with daily costs, total cost, request counts, and token usage.
    """
    if not settings.helicone_api_key:
        return {"error": "Helicone API key not configured", "enabled": False}

    result = {
        "enabled": True,
        "total_cost": 0.0,
        "total_requests": 0,
        "total_tokens": 0,
        "daily_breakdown": [],
        "by_model": {},
        "by_type": {},
    }

    try:
        # Calculate date range
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=days)

        headers = {
            "authorization": f"Bearer {settings.helicone_api_key}",
            "Content-Type": "application/json"
        }

        # Query for requests in the date range
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{HELICONE_API_URL}/request/query",
                headers=headers,
                json={
                    "filter": {
                        "request": {
                            "created_at": {
                                "gte": start_date.isoformat() + "Z",
                                "lte": end_date.isoformat() + "Z"
                            }
                        }
                    },
                    "limit": 1000,
                    "sort": {"created_at": "desc"}
                }
            )

            if response.status_code not in (200, 201):
                logger.error(f"Helicone API error: {response.status_code} - {response.text}")
                return {"error": f"API error: {response.status_code}", "enabled": True}

            data = response.json()
            requests_data = data.get("data", [])

            # Aggregate the data
            daily_costs = {}
            model_costs = {}
            type_costs = {}

            for req in requests_data:
                # Extract cost and token data
                cost = req.get("cost_usd") or req.get("response", {}).get("cost") or 0
                tokens = req.get("total_tokens") or 0
                model = req.get("model") or req.get("request_model") or "unknown"
                created_at = req.get("created_at") or req.get("request_created_at")

                # Get message type from properties
                properties = req.get("properties") or req.get("request_properties") or {}
                msg_type = properties.get("Helicone-Property-MessageType") or properties.get("MessageType") or "other"

                # Update totals
                result["total_cost"] += float(cost) if cost else 0
                result["total_requests"] += 1
                result["total_tokens"] += int(tokens) if tokens else 0

                # Daily breakdown
                if created_at:
                    day = created_at[:10]  # YYYY-MM-DD
                    if day not in daily_costs:
                        daily_costs[day] = {"cost": 0, "requests": 0, "tokens": 0}
                    daily_costs[day]["cost"] += float(cost) if cost else 0
                    daily_costs[day]["requests"] += 1
                    daily_costs[day]["tokens"] += int(tokens) if tokens else 0

                # By model
                if model not in model_costs:
                    model_costs[model] = {"cost": 0, "requests": 0}
                model_costs[model]["cost"] += float(cost) if cost else 0
                model_costs[model]["requests"] += 1

                # By type
                if msg_type not in type_costs:
                    type_costs[msg_type] = {"cost": 0, "requests": 0}
                type_costs[msg_type]["cost"] += float(cost) if cost else 0
                type_costs[msg_type]["requests"] += 1

            # Convert daily breakdown to sorted list
            result["daily_breakdown"] = [
                {"date": date, **stats}
                for date, stats in sorted(daily_costs.items())
            ]

            result["by_model"] = model_costs
            result["by_type"] = type_costs

            logger.info(f"Helicone stats: {result['total_requests']} requests, ${result['total_cost']:.4f} total")

    except httpx.TimeoutException:
        logger.error("Helicone API timeout")
        return {"error": "API timeout", "enabled": True}
    except Exception as e:
        logger.error(f"Error fetching Helicone stats: {e}", exc_info=True)
        return {"error": str(e), "enabled": True}

    return result
