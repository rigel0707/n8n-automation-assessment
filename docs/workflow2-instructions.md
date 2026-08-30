# Workflow 2 — Telegram Receipt Photo Processing

This n8n workflow accepts receipt photos through Telegram, extracts receipt information using Google Gemini, saves the structured data to Google Sheets, uploads the original photo to Google Drive, and sends a confirmation message back to Telegram.

## Workflow

```text
Telegram Trigger
      ↓
Is Receipt Photo?
   ├─ No → Send validation message
   │
   └─ Yes
        ↓
   Download Telegram Receipt
        │
        ├──────────────┐
        ↓              ↓
 Gemini Analyze    Prepare Drive Upload
        ↓              ↓
 Parse Receipt     Upload to Google Drive
        ↓              ↓
 Save to Sheets    Check Drive Success
        ↓
 Check Sheet Success
        │              │
        └──────┬───────┘
               ↓
             Merge
               ↓
     Telegram Success Message
```

## 1. Prerequisites

Install:

```text
Docker Desktop
cloudflared
```

You will also need:

```text
Telegram account
Telegram Bot token
Gemini API key
Google account
Google Sheet
Google Apps Script Web App
```

No Google Cloud project is required for the Sheets/Drive integration in this implementation.

## 2. Start n8n

From the project directory:

```bash
docker compose up -d
```

Verify:

```bash
docker compose ps
```

Open n8n at:

```text
http://localhost:5678
```

## 3. Start the Cloudflare Tunnel

Telegram needs a publicly accessible HTTPS webhook.

Run:

```bash
cloudflared tunnel --url http://localhost:5678
```

Cloudflare will provide a temporary URL similar to:

```text
https://example-random.trycloudflare.com
```

Keep this terminal running.

Update your local `.env`:

```env
WEBHOOK_URL=https://example-random.trycloudflare.com/
```

Then recreate n8n:

```bash
docker compose up -d --force-recreate
```

Verify:

```bash
docker exec n8n printenv WEBHOOK_URL
```

The output should show the Cloudflare URL.

> Cloudflare Quick Tunnel URLs may change whenever the tunnel is restarted. Update `WEBHOOK_URL` and recreate n8n whenever this happens.

## 4. Import the Workflow

In n8n:

```text
Workflows
→ Import from File
```

Import:

```text
workflows/workflow-2-telegram-receipt-processing.json
```

Credentials are intentionally not included in the repository.

## 5. Configure Telegram

Create a Telegram bot using **@BotFather**.

Send:

```text
/newbot
```

Follow the prompts and obtain the bot token.

In n8n, create a new Telegram credential using this token.

Assign that credential to:

```text
Telegram Trigger
Download Telegram Receipt
Success Message
Error Message
Validation Message
```

Send `/start` to the bot once before testing.

## 6. Configure Gemini

Create a Gemini API key through Google AI Studio.

In n8n:

```text
Credentials
→ Google Gemini API
```

Add the API key.

Assign this credential to:

```text
Gemini - Analyze Image
```

The Gemini node receives the downloaded Telegram receipt image and extracts structured fields such as:

```json
{
  "merchant_name": "SAMPLE GROCERY MART",
  "transaction_date": "2026-08-29",
  "total_amount": 425.5,
  "currency": "PHP",
  "receipt_number": "OR-2026-0829-001",
  "payment_method": "cash"
}
```

## 7. Create the Google Sheet

Create a spreadsheet and add a sheet named:

```text
Receipts
```

Add these headers to Row 1:

```text
submission_date
merchant_name
transaction_date
total_amount
currency
receipt_number
payment_method
```

Example:

| submission_date | merchant_name | transaction_date | total_amount | currency | receipt_number | payment_method |
|---|---|---|---:|---|---|---|

Copy the spreadsheet ID from its URL:

```text
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
```

## 8. Configure Google Apps Script

Create a standalone Apps Script project at:

```text
script.google.com
```

The Apps Script acts as the API between n8n and Google Sheets/Drive.

Configure the script with:

```text
SPREADSHEET_ID
```

for the spreadsheet created above.

Also create the following Script Property:

```text
API_SECRET
```

with a secure random value.

A random secret can be generated with:

```bash
openssl rand -hex 32
```

The secret must never be committed to the repository.

## 9. Authorize Google Sheets and Drive

The Apps Script requires permission to:

```text
Write rows to Google Sheets
Read/create Google Drive folders
Upload files to Google Drive
```

Run the authorization helper functions from the Apps Script editor once and approve the required Google permissions.

The Drive scope must permit write operations because the workflow creates folders and uploads files.

## 10. Deploy Apps Script

In Apps Script:

```text
Deploy
→ New Deployment
→ Web App
```

Configure:

```text
Execute as:
Me

Who has access:
Anyone
```

Deploy it and copy the `/exec` URL:

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

Test it in a browser.

Expected response:

```json
{
  "success": true,
  "message": "n8n Receipt API is running"
}
```

## 11. Configure the n8n HTTP Requests

There are two Apps Script calls.

### Save receipt information

The Sheet HTTP Request sends:

```json
{
  "action": "save_receipt",
  "secret": "YOUR_API_SECRET",
  "merchant_name": "...",
  "transaction_date": "...",
  "total_amount": 0,
  "currency": "...",
  "receipt_number": "...",
  "payment_method": "..."
}
```

Set its URL to the Apps Script `/exec` URL.

### Upload original image

The Drive HTTP Request sends:

```json
{
  "action": "upload_receipt",
  "secret": "YOUR_API_SECRET",
  "file_base64": "...",
  "file_name": "...",
  "mime_type": "image/jpeg"
}
```

Use the same Apps Script `/exec` URL.

Replace all placeholder secrets in the imported workflow with your own local values.

## 12. Google Drive Folder Structure

The workflow automatically creates:

```text
My Drive
└── Receipt Automation
    └── YYYY-MM-DD
        ├── receipt-1.jpg
        ├── receipt-2.jpg
        └── ...
```

For example:

```text
Receipt Automation
└── 2026-08-29
    └── file_2.jpg
```

The folder date represents the **submission date**, not necessarily the transaction date printed on the receipt.

## 13. Activate the Workflow

In n8n:

```text
Save
→ Activate
```

The Telegram Trigger will register its webhook using the configured Cloudflare URL.

## 14. Test the Workflow

Open the Telegram bot and send a receipt photo directly.

You do **not** need to send a text message first.

```text
Telegram
    ↓
Send receipt image
```

The workflow should:

```text
1. Receive the Telegram message
2. Verify that it contains a photo
3. Download the largest Telegram image
4. Send the image to Gemini
5. Extract structured receipt information
6. Write the extracted values to Google Sheets
7. Upload the original image to Google Drive
8. Verify both operations succeeded
9. Send a confirmation back to Telegram
```

Expected Telegram response:

```text
✅ Receipt processed successfully

Merchant: SAMPLE GROCERY MART
Amount: PHP 425.5
Date: 2026-08-29
Receipt #: OR-2026-0829-001
```

## 15. Test Invalid Input

Send:

```text
hello
```

instead of an image.

Expected response:

```text
📷 Please send a receipt photo for processing.
```

This confirms that non-image messages are handled without breaking the workflow.

## 16. Verify Google Sheets

A new row should appear:

```text
submission_date | SAMPLE GROCERY MART | 2026-08-29 | 425.5 | PHP | OR-2026-0829-001 | cash
```

## 17. Verify Google Drive

Check:

```text
Google Drive
→ Receipt Automation
→ current submission date
```

The original Telegram image should be present.

## 18. Security

The repository intentionally does **not** include:

```text
Telegram bot token
Gemini API key
Apps Script API_SECRET
n8n encryption key
Google credentials
.env
```

Before committing the exported n8n workflow, verify that no hard-coded `API_SECRET` is present in the JSON.

## Successful Test Criteria

Workflow 2 is considered successful when all of these are verified:

```text
✅ Telegram receives a receipt photo
✅ Non-photo messages are rejected safely
✅ Original Telegram image is downloaded
✅ Gemini extracts the receipt details
✅ Google Sheets receives a new row
✅ Original image is saved to Google Drive
✅ Drive images are grouped by submission date
✅ Telegram returns a success message
✅ Workflow returns an error message when processing fails
```
