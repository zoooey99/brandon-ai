"""
Admin authentication utilities.
Simple password-based auth with signed session cookies.
"""

from fastapi import Request, HTTPException
from fastapi.responses import RedirectResponse
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from functools import wraps
import logging
import hmac

from app.config import settings

logger = logging.getLogger(__name__)

# Cookie settings
COOKIE_NAME = "brandon_admin_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days

# Create serializer for signing cookies
serializer = URLSafeTimedSerializer(settings.admin_secret_key)


def create_session_token() -> str:
    """Create a signed session token."""
    return serializer.dumps({"authenticated": True})


def verify_session_token(token: str) -> bool:
    """Verify a session token is valid and not expired."""
    try:
        data = serializer.loads(token, max_age=COOKIE_MAX_AGE)
        return data.get("authenticated", False)
    except (BadSignature, SignatureExpired):
        return False


def check_password(password: str) -> bool:
    """Check if the provided password matches the admin password (timing-safe)."""
    return hmac.compare_digest(password, settings.admin_password)


def is_authenticated(request: Request) -> bool:
    """Check if the current request has a valid admin session."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return False
    return verify_session_token(token)


def require_admin(request: Request):
    """
    Dependency that requires admin authentication.
    Redirects to login if not authenticated.
    """
    if not is_authenticated(request):
        return RedirectResponse(url="/admin/login", status_code=303)
    return None


def set_auth_cookie(response: RedirectResponse) -> RedirectResponse:
    """Set the authentication cookie on a response."""
    token = create_session_token()
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax"
    )
    return response


def clear_auth_cookie(response: RedirectResponse) -> RedirectResponse:
    """Clear the authentication cookie."""
    response.delete_cookie(key=COOKIE_NAME)
    return response
