"""
Pytest configuration and fixtures.

Sets placeholder values for required environment variables so the app's
Settings object can be constructed without live credentials. All external
services (Supabase, OpenAI, Stripe, Mac relay) are mocked in tests —
these values are never used to make real network calls.
"""

import os
import sys
from pathlib import Path

# Add the project root to the Python path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

_TEST_ENV_DEFAULTS = {
    "SUPABASE_URL": "https://test-project.supabase.co",
    "SUPABASE_SERVICE_KEY": "test-service-key",
    "MAC_SERVER_URL": "http://localhost:8787",
    "MAC_SERVER_APIKEY": "test-mac-server-key",
    "REMOTE_SERVER_APIKEY": "test-remote-server-key",
    "OPENAI_API_KEY": "test-openai-key",
    "ADMIN_PASSWORD": "test-admin-password",
    "ADMIN_SECRET_KEY": "test-admin-secret-key-min-32-chars!!",
}

for _key, _value in _TEST_ENV_DEFAULTS.items():
    os.environ.setdefault(_key, _value)
