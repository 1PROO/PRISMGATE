#!/bin/bash
# PrismGate Admin Deployment Script
# Automatically deploys the API Worker and Pages UI

# Colors for terminal output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting PrismGate Admin Deployment...${NC}"

# 1. Deploy Admin API Worker
echo -e "\n${BLUE}[1/2] Deploying Admin API Cloudflare Worker...${NC}"
cd admin-api
npm install
npx wrangler deploy
cd ..

# 2. Deploy Admin UI to Cloudflare Pages
echo -e "\n${BLUE}[2/2] Deploying Admin UI to Cloudflare Pages...${NC}"
# This will deploy the static directory 'admin-ui' to a project named 'prismgate-admin-ui'
npx wrangler pages deploy admin-ui --project-name prismgate-admin-ui

echo -e "\n${GREEN}✔ PrismGate Admin Deployment Complete!${NC}"
echo -e "Make sure to grab the deployed API URL from step 1 and enter it in the Admin UI Dashboard login page."
