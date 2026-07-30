#!/bin/bash

# Configuration - set this to your ngrok domain (without https://)
NGROK_DOMAIN="${NGROK_DOMAIN:-your-domain.ngrok-free.dev}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting iMessage Relay Server...${NC}"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Warning: .env file not found.${NC}"
    echo -e "${YELLOW}Copy .env.example to .env and fill in your configuration first.${NC}"
    exit 1
fi

# Check if ngrok is configured
if ! ngrok config check &>/dev/null; then
    echo -e "${YELLOW}Error: ngrok is not configured.${NC}"
    echo "Please run: ngrok config add-authtoken YOUR_AUTHTOKEN"
    exit 1
fi

# Start the server in the background
echo -e "${GREEN}Starting server on port 8787...${NC}"
node server.js &
SERVER_PID=$!

# Wait for server to start
sleep 2

# Check if server started successfully
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo -e "${YELLOW}Error: Server failed to start${NC}"
    exit 1
fi

echo -e "${GREEN}Server started (PID: $SERVER_PID)${NC}"
echo ""
echo -e "${BLUE}Starting ngrok tunnel...${NC}"
echo -e "${GREEN}Your public URL: https://${NGROK_DOMAIN}${NC}"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop both server and tunnel${NC}"
echo ""

# Start ngrok
ngrok http 8787 --domain="${NGROK_DOMAIN}"

# Cleanup on exit
echo ""
echo -e "${BLUE}Shutting down...${NC}"
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
echo -e "${GREEN}Done!${NC}"
