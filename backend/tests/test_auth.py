"""
Tests for authentication: Mac-server webhook API key + admin session cookies.

Run with: pytest tests/test_auth.py -v
"""

import pytest
from unittest.mock import Mock, patch
from fastapi import HTTPException

from app.config import settings
from app.api.routes.messages import verify_mac_server_auth
from app.admin.auth import (
    create_session_token,
    verify_session_token,
    check_password,
    is_authenticated,
    COOKIE_NAME,
)


# ===================================================================
# Webhook API-key verification (Mac relay -> backend)
# ===================================================================

class TestVerifyMacServerAuth:
    def test_valid_api_key_passes(self):
        # Should not raise
        verify_mac_server_auth(f"Bearer {settings.remote_server_apikey}")

    def test_missing_header_rejected(self):
        with pytest.raises(HTTPException) as exc:
            verify_mac_server_auth(None)
        assert exc.value.status_code == 401
        assert "Missing" in exc.value.detail

    def test_wrong_key_rejected(self):
        with pytest.raises(HTTPException) as exc:
            verify_mac_server_auth("Bearer wrong-key")
        assert exc.value.status_code == 401
        assert "Invalid" in exc.value.detail

    def test_key_without_bearer_prefix_rejected(self):
        with pytest.raises(HTTPException) as exc:
            verify_mac_server_auth(settings.remote_server_apikey)
        assert exc.value.status_code == 401

    def test_empty_header_rejected(self):
        with pytest.raises(HTTPException) as exc:
            verify_mac_server_auth("")
        assert exc.value.status_code == 401


# ===================================================================
# Admin session tokens
# ===================================================================

class TestAdminSessionToken:
    def test_round_trip(self):
        token = create_session_token()
        assert verify_session_token(token) is True

    def test_tampered_token_invalid(self):
        token = create_session_token()
        assert verify_session_token(token + "x") is False

    def test_garbage_token_invalid(self):
        assert verify_session_token("not-a-real-token") is False

    def test_expired_token_invalid(self):
        token = create_session_token()
        with patch("app.admin.auth.COOKIE_MAX_AGE", -1):
            assert verify_session_token(token) is False


class TestCheckPassword:
    def test_correct_password(self):
        assert check_password(settings.admin_password) is True

    def test_wrong_password(self):
        assert check_password("wrong-password") is False

    def test_empty_password(self):
        assert check_password("") is False


class TestIsAuthenticated:
    def _request_with_cookies(self, cookies):
        request = Mock()
        request.cookies = cookies
        return request

    def test_no_cookie(self):
        assert is_authenticated(self._request_with_cookies({})) is False

    def test_valid_cookie(self):
        token = create_session_token()
        request = self._request_with_cookies({COOKIE_NAME: token})
        assert is_authenticated(request) is True

    def test_invalid_cookie(self):
        request = self._request_with_cookies({COOKIE_NAME: "bogus"})
        assert is_authenticated(request) is False
