#!/usr/bin/env python3
"""
Utility script to generate secure API keys for Brandon Backend.
Uses Python's secrets module to generate cryptographically secure random tokens.
"""

import secrets
import sys


def generate_api_key(length: int = 32) -> str:
    """
    Generate a secure API key using URL-safe base64 encoding.
    
    Args:
        length: Number of bytes to use for the key (default: 32)
    
    Returns:
        A URL-safe base64-encoded string
    """
    return secrets.token_urlsafe(length)


if __name__ == "__main__":
    # Optional: allow custom length via command line argument
    length = 32
    if len(sys.argv) > 1:
        try:
            length = int(sys.argv[1])
        except ValueError:
            print(f"Invalid length: {sys.argv[1]}. Using default: 32", file=sys.stderr)
    
    api_key = generate_api_key(length)
    print(api_key)

