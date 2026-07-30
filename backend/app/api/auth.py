"""
Authentication utilities for Brandon Backend.
Verifies Supabase JWT tokens for protected endpoints.
"""

from fastapi import Header, HTTPException, Depends
from typing import Optional
import logging

from app.db.supabase_client import get_supabase

logger = logging.getLogger(__name__)


class AuthenticatedUser:
    """Represents an authenticated user from Supabase JWT."""
    def __init__(self, user_id: str, email: Optional[str] = None):
        self.user_id = user_id
        self.email = email


async def get_current_user(
    authorization: Optional[str] = Header(None, alias="Authorization")
) -> AuthenticatedUser:
    """
    Verify Supabase JWT token and return authenticated user.

    Expects header: Authorization: Bearer <access_token>

    Raises:
        HTTPException 401 if token is missing or invalid
    """
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization header"
        )

    # Extract token from "Bearer <token>"
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Invalid Authorization header format. Expected: Bearer <token>"
        )

    token = parts[1]

    try:
        # Use Supabase to verify the token
        supabase = get_supabase()

        # Get user from token - this validates the JWT
        user_response = supabase.auth.get_user(token)

        if not user_response or not user_response.user:
            raise HTTPException(
                status_code=401,
                detail="Invalid or expired token"
            )

        user = user_response.user
        logger.debug(f"Authenticated user: {user.id}")

        return AuthenticatedUser(
            user_id=user.id,
            email=user.email
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Auth error: {e}")
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token"
        )
