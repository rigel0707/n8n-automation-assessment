# n8n Automation Assessment

This repository contains two n8n automation workflows:

1. **Workflow 1 — Gmail Automation**
   - Poll Gmail on a schedule
   - Process selected Gmail labels
   - Log messages into Google Sheets
   - Save attachments into Google Drive
   - Preserve original filenames
   - Prevent duplicate processing
   - Send Telegram alerts when the workflow fails

2. **Workflow 2 — Telegram Receipt Automation**
   - Receive receipt images through a Telegram bot
   - Download the original Telegram image
   - Analyze the receipt with Google Gemini
   - Extract structured receipt information
   - Send the extracted data and original image to Google Apps Script
   - Save the receipt image to Google Drive
   - Log receipt data into Google Sheets

Both workflows use the same Google Apps Script Web App for Google-side operations.

---

## Repository Structure

Recommended structure:

```text
n8n-assessment/
├── README.md
├── docker-compose.yml
├── .env.example
├── .gitignore
│
├── workflows/
│   ├── workflow-1-gmail-apps-script.json
│   ├── workflow-1-error-handler.json
│   └── workflow-2-telegram-receipt.json
│
├── google-apps-script/
│   └── Code.gs
│
├── docs/
│   ├── WORKFLOW1_INSTRUCTIONS.md
│   └── WORKFLOW2_INSTRUCTIONS.md
│
└── screenshots/
```

Do not commit real secrets.

---

# Architecture

```text
                          n8n
                ┌──────────┴──────────┐
                │                     │
          Workflow 1             Workflow 2
          Gmail schedule         Telegram image
                │                     │
                │                  Gemini
                │                     │
                └──────────┬──────────┘
                           │
                           v
                 Google Apps Script
                           │
              ┌────────────┼────────────┐
              │            │            │
            Gmail         Drive        Sheets
```

Workflow 2 also receives incoming Telegram webhooks through Cloudflare Tunnel when n8n is running locally.

---

# Requirements

## Local software

Install:

- Docker Desktop
- Docker Compose
- `cloudflared`
- Git

Check Docker:

```bash
docker --version
docker compose version
```

Install Cloudflare Tunnel on macOS:

```bash
brew install cloudflared
```

Check:

```bash
cloudflared --version
```

## Accounts / Credentials

You need:

- A Google account for testing
- Gmail
- Google Drive
- Google Sheets
- Google Apps Script
- Telegram account
- Telegram bot token from BotFather
- Google Gemini API key

Recommended: use a dedicated test Google account instead of your primary personal account.

---

# 1. Clone or Download the Repository

Example:

```bash
git clone <your-repository-url>
cd n8n-assessment
```

---

# 2. Create `.env`

Create:

```bash
cp .env.example .env
```

If `.env.example` does not exist yet, create `.env` manually.

Example:

```env
N8N_ENCRYPTION_KEY=CHANGE_ME
WEBHOOK_URL=http://localhost:5678/
```

Generate an n8n encryption key:

```bash
openssl rand -hex 32
```

Put the generated value into:

```env
N8N_ENCRYPTION_KEY=<generated-value>
```

Do not commit `.env`.

Recommended `.gitignore`:

```gitignore
.env
.DS_Store
```

---

# 3. Docker Configuration

Example `docker-compose.yml`:

```yaml
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n:latest
    container_name: n8n
    restart: unless-stopped

    ports:
      - "127.0.0.1:5678:5678"

    environment:
      - GENERIC_TIMEZONE=Asia/Manila
      - TZ=Asia/Manila
      - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
      - N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
      - WEBHOOK_URL=${WEBHOOK_URL}

    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
```

---

# 4. Start n8n

Run:

```bash
docker compose up -d
```

Check:

```bash
docker compose ps
```

View logs if needed:

```bash
docker compose logs -f n8n
```

Open:

```text
http://localhost:5678
```

Create the local n8n owner account if this is the first run.

---

# 5. Configure Cloudflare Tunnel

Workflow 2 uses a Telegram Trigger, so Telegram needs a public HTTPS webhook URL.

Start a Quick Tunnel:

```bash
cloudflared tunnel --url http://localhost:5678
```

Cloudflare returns a URL similar to:

```text
https://example-random-name.trycloudflare.com
```

Keep this terminal running.

Update `.env`:

```env
WEBHOOK_URL=https://example-random-name.trycloudflare.com/
```

Recreate n8n:

```bash
docker compose up -d --force-recreate
```

Verify:

```bash
docker exec n8n printenv WEBHOOK_URL
```

Expected:

```text
https://example-random-name.trycloudflare.com/
```

Quick Tunnel URLs can change whenever `cloudflared` is restarted.

If the URL changes:

1. Update `.env`
2. Recreate n8n
3. Reactivate the Telegram Trigger workflow if necessary

---

# 6. Google Apps Script Setup

Both workflows use one Google Apps Script Web App.

## Source file

Use:

```text
google-apps-script/Code.gs
```

The script supports:

```text
process_gmail
save_receipt
```

## Configure API Secret

Generate a secret:

```bash
openssl rand -hex 32
```

In Google Apps Script:

```text
Project Settings
  -> Script Properties
```

Add:

```text
Property: API_SECRET
Value: <generated-secret>
```

Use the same secret in the relevant n8n workflow Config/HTTP Request values.

Never commit it.

## Deploy Web App

In Google Apps Script:

```text
Deploy
  -> Manage deployments
  -> New deployment
  -> Web app
```

Use:

```text
Execute as: Me
Who has access: Anyone
```

Copy the generated `/exec` URL.

Example:

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

If updating an existing Web App:

```text
Deploy
  -> Manage deployments
  -> Edit
  -> New version
  -> Deploy
```

This keeps the same Web App URL.

## Google Permissions

Authorize access to:

- Gmail
- Google Drive
- Google Sheets

The Web App runs under the Google account that owns the test environment.

---

# 7. Telegram Bot Setup

In Telegram, open:

```text
@BotFather
```

Send:

```text
/newbot
```

Follow the prompts.

Save the bot token privately.

In n8n create a Telegram credential using that token.

Start a private chat with your bot and send:

```text
/start
```

Workflow 2 uses:

```text
Telegram Trigger
  -> Telegram Get File
```

The same bot credential should be used for both nodes.

---

# 8. Gemini Setup

Create a Gemini API key using Google AI Studio.

In n8n create a Google Gemini credential.

Recommended model:

```text
gemini-2.5-flash
```

Workflow 2 should analyze the downloaded Telegram image and return structured receipt data such as:

```json
{
  "merchant_name": "SAMPLE GROCERY MART",
  "transaction_date": "2026-08-29",
  "total_amount": 425.50,
  "currency": "PHP",
  "receipt_number": "OR-2026-0829-001",
  "payment_method": "CASH"
}
```

Do not commit the Gemini API key.

---

# 9. Import n8n Workflows

In n8n:

```text
Workflows
  -> Import from File
```

Import:

```text
workflows/workflow-1-gmail-apps-script.json
workflows/workflow-1-error-handler.json
workflows/workflow-2-telegram-receipt.json
```

---

# 10. Configure Workflow 1

Workflow 1 calls Apps Script with:

```json
{
  "action": "process_gmail"
}
```

Configure its `Config` node with:

```text
apiSecret: same value as Apps Script API_SECRET
```

Example monitored labels:

```json
[
  "Assessment-Label-1",
  "Assessment-Label-2",
  "Assessment-Label-3"
]
```

Defaults:

```text
processedLabel: n8n-processed
driveRootFolderName: n8n Gmail Attachments
spreadsheetName: n8n Gmail Automation
sheetName: Email Log
```

Set the Workflow 1 error workflow to:

```text
Workflow 1 - Error Handler
```

Configure the error workflow's Telegram credential and Chat ID.

See:

```text
docs/WORKFLOW1_INSTRUCTIONS.md
```

for detailed Workflow 1 behavior and testing.

---

# 11. Configure Workflow 2

Workflow 2 flow:

```text
Telegram Trigger
        |
        v
Telegram Get File
        |
        v
Gemini Analyze Image
        |
        v
Parse structured result
        |
        v
Convert image to Base64
        |
        v
HTTP Request -> Apps Script
        |
        v
action = save_receipt
```

The Apps Script request should include:

```json
{
  "action": "save_receipt",
  "secret": "YOUR_API_SECRET",
  "receipt": {
    "merchant_name": "...",
    "transaction_date": "YYYY-MM-DD",
    "total_amount": 0,
    "currency": "PHP",
    "receipt_number": "...",
    "payment_method": "..."
  },
  "telegram_chat_id": "...",
  "telegram_message_id": "...",
  "file_name": "receipt.jpg",
  "mime_type": "image/jpeg",
  "image_base64": "..."
}
```

The Apps Script then writes to:

```text
Google Drive:
n8n Receipt Images/<transaction-date>/<original-file-name>

Google Sheets:
n8n Receipt Automation / Receipts
```

---

# 12. Running Both Workflows

## Start local services

Terminal 1:

```bash
docker compose up -d
```

Terminal 2:

```bash
cloudflared tunnel --url http://localhost:5678
```

If Cloudflare gives a new URL, update:

```env
WEBHOOK_URL=https://NEW-URL.trycloudflare.com/
```

Then:

```bash
docker compose up -d --force-recreate
```

Open:

```text
http://localhost:5678
```

## Workflow 1

Activate Workflow 1.

Its Schedule Trigger will run at the configured interval, for example:

```text
Every 5 minutes
```

For manual testing, use its Manual Trigger if included.

## Workflow 2

Activate Workflow 2.

Send a receipt image directly to the Telegram bot.

Expected flow:

```text
Telegram image
  -> n8n
  -> Gemini
  -> Apps Script
  -> Google Drive + Google Sheets
```

---

# 13. Testing Workflow 1

Create test Gmail labels:

```text
Assessment-Label-1
Assessment-Label-2
Assessment-Label-3
```

Send test messages and apply one of the labels.

Test:

- Email without attachment
- Email with one attachment
- Email with multiple attachments
- Same email processed twice
- Message under another monitored label

Verify:

- Google Sheet row created
- Drive hierarchy created
- Original filename retained
- No duplicate rows/files
- `n8n-processed` label added

---

# 14. Testing Workflow 2

Send a test receipt image directly to the Telegram bot.

Verify:

- Telegram Trigger runs
- Image is downloaded
- Gemini extracts receipt data
- Apps Script returns `success: true`
- Image appears in Google Drive
- Row appears in the Receipt spreadsheet
- Re-running the same Telegram message does not create duplicates

---

# 15. Error Handling

Workflow 1 includes:

```text
Main Workflow Failure
        |
        v
Error Trigger
        |
        v
Telegram Alert
```

Recommended for Workflow 2 as well.

Example Telegram alert:

```text
n8n Workflow Failed

Workflow: Workflow 1 - Gmail to Sheets and Drive
Node: Apps Script - Process Gmail
Error: Unauthorized request
Execution ID: 123
```

Never use `Continue On Fail` for critical persistence steps unless the workflow explicitly handles the failure.

---

# 16. Useful Docker Commands

Start:

```bash
docker compose up -d
```

Stop:

```bash
docker compose stop
```

Restart:

```bash
docker compose restart
```

Status:

```bash
docker compose ps
```

Logs:

```bash
docker compose logs -f n8n
```

Update n8n:

```bash
docker compose pull
docker compose up -d
```

Stop and remove containers without deleting data:

```bash
docker compose down
```

Avoid unless intentionally deleting all n8n data:

```bash
docker compose down -v
```

The `-v` option removes the persistent n8n volume.

---

# 17. Secrets and Security

Never commit:

```text
.env
Telegram bot token
Gemini API key
Apps Script API_SECRET
n8n encryption key
Google access tokens
OAuth client secrets
```

Safe to commit:

```text
docker-compose.yml
.env.example
workflow JSON exports
Code.gs
README.md
screenshots without secrets
architecture documentation
```

Example `.env.example`:

```env
N8N_ENCRYPTION_KEY=generate-with-openssl
WEBHOOK_URL=https://your-public-webhook-url/
```

Do not put real values into `.env.example`.

---

# 18. Local Hosting Limitation

This assessment runs n8n locally.

The environment is available only while:

```text
Laptop is on
Docker is running
n8n container is running
Cloudflare Tunnel is running
```

This is sufficient for development, testing, recorded demonstrations, and live interview demos.

A production deployment would normally run n8n on an always-on server or managed n8n environment.

---


# Technology Used

- n8n Community Edition
- Docker
- Cloudflare Tunnel
- Google Apps Script
- Gmail
- Google Drive
- Google Sheets
- Telegram Bot API
- Google Gemini
