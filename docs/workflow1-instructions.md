# Workflow 1 — Gmail to Google Sheets and Google Drive

## Overview

Workflow 1 is an n8n automation that periodically asks a Google Apps Script Web App to process Gmail messages from selected labels.

Google Apps Script performs the Google-side operations:

- Search Gmail messages under configured labels
- Extract sender, subject, received date, and message ID
- Detect and download attachments
- Create a Google Drive folder hierarchy
- Preserve each attachment's original filename
- Log processed emails into Google Sheets
- Prevent duplicate processing
- Apply an `n8n-processed` Gmail label
- Return a JSON summary to n8n

n8n is responsible for:

- Running the workflow every 5 minutes
- Calling the Apps Script endpoint
- Validating the Apps Script response
- Recording the execution result
- Triggering an error workflow if processing fails

## Architecture

```text
n8n Schedule Trigger
        |
        v
Config
        |
        v
HTTP Request
        |
        v
Google Apps Script Web App
        |
        +--> Gmail
        |
        +--> Google Drive
        |
        +--> Google Sheets
        |
        v
JSON response to n8n
        |
        v
Validate Response
        |
        +--> Success
        |
        +--> Failure --> n8n Error Workflow --> Telegram alert
```

## Required Files

The repository should contain:

```text
workflows/
  workflow-1-gmail-apps-script.json
  workflow-1-error-handler.json

google-apps-script/
  Code.gs
```

`Code.gs` can be shared by Workflow 1 and Workflow 2.

## Google Apps Script Action

Workflow 1 calls the shared Apps Script Web App with:

```json
{
  "action": "process_gmail"
}
```

The Apps Script function routes the request to:

```javascript
processGmail(payload)
```

## Gmail Labels

Create the Gmail labels you want n8n to process.

Example:

```text
Assessment-Label-1
Assessment-Label-2
Assessment-Label-3
n8n-processed
```

The first three labels are monitored.

`n8n-processed` is added after successful processing as a visual indicator.

Duplicate prevention does not rely only on this label. The Apps Script stores a record key based on:

```text
Gmail Message ID + monitored label
```

Example:

```text
18d02974abc::Assessment-Label-1
```

This allows later replies in the same Gmail thread to be processed if they have a new Gmail message ID.

## Google Drive Output

Apps Script automatically creates the root folder if it does not exist.

Default root:

```text
n8n Gmail Attachments
```

Attachments are stored using:

```text
n8n Gmail Attachments/
  <gmail-label>/
    <received-date>/
      <sender-name>/
        <original-file-name>
```

Example:

```text
n8n Gmail Attachments/
  Assessment-Label-1/
    2026-08-30/
      John Smith/
        invoice.pdf
        quotation.xlsx
```

The original Gmail attachment filename is retained.

## Google Sheets Output

Apps Script automatically creates a spreadsheet if it does not exist.

Default spreadsheet:

```text
n8n Gmail Automation
```

Default worksheet:

```text
Email Log
```

Expected columns:

```text
Record Key
Message ID
Received At
Received Date
Sender Name
Sender Email
Subject
Label
Attachment Count
Attachment Names
Drive Folder ID
Drive Folder URL
Status
Processed At
```

## Apps Script Configuration

### 1. Open Google Apps Script

Create or open the Apps Script project used by both workflows.

Paste the combined script into:

```text
Code.gs
```

### 2. Configure API_SECRET

In Apps Script:

```text
Project Settings
  -> Script Properties
  -> Add script property
```

Create:

```text
Property: API_SECRET
Value: <your-random-secret>
```

Generate a secret locally if needed:

```bash
openssl rand -hex 32
```

Do not commit this secret to Git.

### 3. Deploy as a Web App

In Apps Script:

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

Copy the `/exec` Web App URL.

Example:

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

### 4. Authorize Google Access

The Apps Script project needs permission to access:

- Gmail
- Google Drive
- Google Sheets

Authorize the requested permissions using the Google account that owns the test Gmail, Drive, and Sheets data.

## Import Workflow 1 into n8n

In n8n:

```text
Workflows
  -> Import from File
```

Import:

```text
workflows/workflow-1-gmail-apps-script.json
```

Also import:

```text
workflows/workflow-1-error-handler.json
```

## Configure the Workflow 1 Config Node

Open:

```text
Workflow 1 - Gmail to Sheets and Drive
```

Find the `Config` node.

Set:

```text
apiSecret
```

to the same value stored in Apps Script `API_SECRET`.

Configure the monitored labels:

```json
[
  "Assessment-Label-1",
  "Assessment-Label-2",
  "Assessment-Label-3"
]
```

Configure the remaining values if you want to rename them:

```text
processedLabel: n8n-processed
driveRootFolderName: n8n Gmail Attachments
spreadsheetName: n8n Gmail Automation
sheetName: Email Log
```

## Apps Script Request Payload

The n8n HTTP Request sends a payload similar to:

```json
{
  "action": "process_gmail",
  "secret": "YOUR_API_SECRET",
  "labels": [
    "Assessment-Label-1",
    "Assessment-Label-2",
    "Assessment-Label-3"
  ],
  "processed_label": "n8n-processed",
  "drive_root_folder_name": "n8n Gmail Attachments",
  "spreadsheet_name": "n8n Gmail Automation",
  "sheet_name": "Email Log"
}
```

## Expected Apps Script Response

Successful request:

```json
{
  "success": true,
  "processed": 3,
  "attachments_uploaded": 2,
  "skipped": 1,
  "errors": [],
  "error": null
}
```

Failed or partially failed request:

```json
{
  "success": false,
  "processed": 2,
  "attachments_uploaded": 1,
  "skipped": 0,
  "errors": [
    {
      "message_id": "abc123",
      "error": "Example processing error"
    }
  ],
  "error": "1 Gmail item(s) failed"
}
```

The `Validate Response` node intentionally fails the n8n execution when `success` is `false`.

## Error Handling

Workflow 1 uses a separate n8n error workflow:

```text
Error Trigger
  -> Format Error
  -> Telegram Send Message
```

Import:

```text
workflow-1-error-handler.json
```

Then open the main Workflow 1 settings and set:

```text
Error Workflow:
Workflow 1 - Error Handler
```

Configure the Telegram node with:

- Telegram bot credential
- Your Telegram chat ID

A failure message can look like:

```text
n8n Workflow Failed

Workflow: Workflow 1 - Gmail to Sheets and Drive
Node: Apps Script - Process Gmail
Error: Gmail automation failed: 1 Gmail item(s) failed

Execution ID: 123
```

## Test Workflow 1

### Test Email 1 — No Attachment

1. Send a test email to the Gmail test account.
2. Apply `Assessment-Label-1`.
3. Run Workflow 1 manually.
4. Confirm:
   - A new row is added to `Email Log`
   - Attachment Count is `0`
   - The message/thread receives the `n8n-processed` label

### Test Email 2 — With Attachment

1. Send a second test email with an attachment.
2. Apply `Assessment-Label-2`.
3. Run Workflow 1.
4. Confirm:
   - The email is logged in Google Sheets
   - The Drive folder hierarchy is created
   - The attachment appears in Drive
   - The original filename is unchanged
   - The message/thread receives the processed label

### Test Duplicate Protection

Run Workflow 1 again without adding a new message.

Expected result:

```text
processed: 0
skipped: 1 or more
```

No duplicate Sheet row or Drive file should be created.

### Test Failure Handling

Temporarily provide an incorrect Apps Script secret in n8n and run the workflow.

Expected result:

- Apps Script returns `success: false`
- Main workflow fails
- Error workflow runs
- Telegram receives an error notification

Restore the correct secret afterward.

## Production Notes

This assessment setup intentionally uses:

```text
n8n -> Apps Script -> Google services
```

instead of configuring three separate OAuth integrations directly inside n8n.

For a production system, consider:

- Dedicated Google Cloud project
- Restricted OAuth scopes
- More robust API authentication
- Structured logging
- Retry/backoff strategy
- Persistent hosted n8n deployment
- Centralized secrets management
