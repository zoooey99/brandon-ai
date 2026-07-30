"""
Tests for user deletion with Stripe subscription cancellation.

Run with: pytest tests/test_delete_user.py -v
"""

import pytest
from unittest.mock import Mock, patch, MagicMock, AsyncMock
import sys


class TestDeleteUserStripeCancellation:
    """Test that deleting a user cancels their Stripe subscription."""

    @pytest.fixture
    def mock_request(self):
        """Create a mock authenticated request."""
        request = Mock()
        return request

    @pytest.mark.asyncio
    async def test_cancels_stripe_subscription_when_user_has_one(self, mock_request):
        """When a user has a subscription, it should be cancelled before deletion."""
        with patch.dict(sys.modules, {'stripe': MagicMock()}):
            import stripe

            with patch("app.admin.routes.get_supabase") as mock_get_supabase, \
                 patch("app.admin.routes.is_authenticated", return_value=True), \
                 patch("app.admin.routes.stripe", stripe), \
                 patch("app.admin.routes.settings") as mock_settings:

                mock_settings.stripe_secret_key = "sk_test_xxx"

                mock_supabase = MagicMock()
                mock_get_supabase.return_value = mock_supabase

                # User has a subscription
                mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
                    "stripe_subscription_id": "sub_123abc"
                }

                from app.admin.routes import delete_user

                await delete_user(mock_request, "user_123")

                # Assert - Stripe subscription was cancelled
                stripe.Subscription.cancel.assert_called_once_with("sub_123abc")

    @pytest.mark.asyncio
    async def test_skips_stripe_when_user_has_no_subscription(self, mock_request):
        """When a user has no subscription, skip Stripe and proceed with deletion."""
        with patch.dict(sys.modules, {'stripe': MagicMock()}):
            import stripe

            with patch("app.admin.routes.get_supabase") as mock_get_supabase, \
                 patch("app.admin.routes.is_authenticated", return_value=True), \
                 patch("app.admin.routes.stripe", stripe), \
                 patch("app.admin.routes.settings") as mock_settings:

                mock_settings.stripe_secret_key = "sk_test_xxx"

                mock_supabase = MagicMock()
                mock_get_supabase.return_value = mock_supabase

                # User has NO subscription
                mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
                    "stripe_subscription_id": None
                }

                from app.admin.routes import delete_user

                await delete_user(mock_request, "user_123")

                # Assert - Stripe was NOT called
                stripe.Subscription.cancel.assert_not_called()

                # But user was still deleted
                assert mock_supabase.auth.admin.delete_user.called

    @pytest.mark.asyncio
    async def test_continues_deletion_when_stripe_fails(self, mock_request):
        """If Stripe cancellation fails, still delete the user."""
        import stripe as real_stripe

        # Create a mock that has real exception classes
        mock_stripe = MagicMock()
        mock_stripe.error = real_stripe.error

        with patch("app.admin.routes.get_supabase") as mock_get_supabase, \
             patch("app.admin.routes.is_authenticated", return_value=True), \
             patch("app.admin.routes.stripe", mock_stripe), \
             patch("app.admin.routes.settings") as mock_settings:

            mock_settings.stripe_secret_key = "sk_test_xxx"

            mock_supabase = MagicMock()
            mock_get_supabase.return_value = mock_supabase

            # User has a subscription
            mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
                "stripe_subscription_id": "sub_123abc"
            }

            # Stripe fails with InvalidRequestError (subscription already cancelled)
            mock_stripe.Subscription.cancel.side_effect = real_stripe.error.InvalidRequestError(
                "No such subscription", param=None
            )

            from app.admin.routes import delete_user

            response = await delete_user(mock_request, "user_123")

            # Assert - User was still deleted despite Stripe error
            assert mock_supabase.auth.admin.delete_user.called
            # URL is encoded, so check for the key part
            assert "deleted" in response.headers.get("location", "")
            assert "success" in response.headers.get("location", "")

    @pytest.mark.asyncio
    async def test_skips_stripe_when_no_api_key_configured(self, mock_request):
        """When STRIPE_SECRET_KEY is not set, skip cancellation but still delete."""
        with patch.dict(sys.modules, {'stripe': MagicMock()}):
            import stripe

            with patch("app.admin.routes.get_supabase") as mock_get_supabase, \
                 patch("app.admin.routes.is_authenticated", return_value=True), \
                 patch("app.admin.routes.stripe", stripe), \
                 patch("app.admin.routes.settings") as mock_settings:

                # No Stripe key
                mock_settings.stripe_secret_key = ""

                mock_supabase = MagicMock()
                mock_get_supabase.return_value = mock_supabase

                # User has a subscription
                mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
                    "stripe_subscription_id": "sub_123abc"
                }

                from app.admin.routes import delete_user

                await delete_user(mock_request, "user_123")

                # Assert - Stripe was NOT called (no API key)
                stripe.Subscription.cancel.assert_not_called()

                # But user was still deleted
                assert mock_supabase.auth.admin.delete_user.called
