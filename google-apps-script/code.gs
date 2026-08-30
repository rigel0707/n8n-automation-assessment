/**
 * ================================================================
 * n8n Automation Assessment - Google Apps Script API
 * ================================================================
 *
 * Supported actions:
 *
 * 1. process_gmail
 *    Workflow 1:
 *    Gmail -> Google Drive -> Google Sheets
 *
 * 2. save_receipt
 *    Workflow 2:
 *    Telegram/Gemini -> Google Drive -> Google Sheets
 *
 * Authentication:
 *    Set API_SECRET in:
 *    Apps Script -> Project Settings -> Script Properties
 *
 * ================================================================
 */


const DEFAULT_TIMEZONE = 'Asia/Manila';


/**
 * ------------------------------------------------
 * WEB APP ENTRY POINTS
 * ------------------------------------------------
 */

function doGet() {
  return jsonResponse({
    success: true,
    service: 'n8n Automation Assessment API',
    status: 'online',
    actions: [
      'process_gmail',
      'save_receipt'
    ],
    timestamp: new Date().toISOString()
  });
}


function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({
        success: false,
        error: 'Empty request body'
      });
    }

    let payload;

    try {
      payload = JSON.parse(e.postData.contents);
    } catch (error) {
      return jsonResponse({
        success: false,
        error: 'Request body must be valid JSON'
      });
    }

    validateSecret(payload.secret);

    const action = payload.action;

    switch (action) {
      case 'process_gmail':
        return jsonResponse(processGmail(payload));

      case 'save_receipt':
        return jsonResponse(saveReceipt(payload));

      default:
        return jsonResponse({
          success: false,
          error: `Unknown action: ${action || '(missing)'}`
        });
    }

  } catch (error) {
    console.error(error);

    return jsonResponse({
      success: false,
      error: error.message || String(error),
      timestamp: new Date().toISOString()
    });
  }
}


/**
 * ================================================================
 * WORKFLOW 1
 * Gmail -> Drive -> Sheets
 * ================================================================
 */

function processGmail(payload) {

  const labels = payload.labels;

  if (!Array.isArray(labels) || labels.length === 0) {
    throw new Error('labels must contain at least one Gmail label');
  }

  const processedLabelName =
    payload.processed_label || 'n8n-processed';

  const rootFolderName =
    payload.drive_root_folder_name ||
    'n8n Gmail Attachments';

  const spreadsheetName =
    payload.spreadsheet_name ||
    'n8n Gmail Automation';

  const sheetName =
    payload.sheet_name ||
    'Email Log';

  const maxThreadsPerLabel =
    Number(payload.max_threads_per_label || 50);


  /*
   * --------------------------------
   * Prepare Google resources
   * --------------------------------
   */

  const rootFolder =
    getOrCreateRootFolder(rootFolderName);

  const sheet =
    getOrCreateSheet(
      spreadsheetName,
      sheetName,
      [
        'Record Key',
        'Message ID',
        'Received At',
        'Received Date',
        'Sender Name',
        'Sender Email',
        'Subject',
        'Label',
        'Attachment Count',
        'Attachment Names',
        'Drive Folder ID',
        'Drive Folder URL',
        'Status',
        'Processed At'
      ]
    );

  const existingKeys =
    getExistingKeys(sheet);

  const processedLabel =
    getOrCreateGmailLabel(processedLabelName);


  /*
   * --------------------------------
   * Result counters
   * --------------------------------
   */

  let processed = 0;
  let skipped = 0;
  let attachmentsUploaded = 0;

  const errors = [];


  /*
   * --------------------------------
   * Process each configured label
   * --------------------------------
   */

  for (const labelNameRaw of labels) {

    const labelName =
      String(labelNameRaw || '').trim();

    if (!labelName) {
      continue;
    }

    try {

      /*
       * Gmail labels are thread-oriented.
       *
       * We intentionally DO NOT exclude
       * n8n-processed here.
       *
       * Duplicate prevention uses:
       *
       * messageId + labelName
       *
       * This is more reliable because a future
       * reply inside an already-labelled thread
       * receives a new Gmail Message ID and can
       * still be processed.
       */

      const query =
        `label:"${escapeGmailQuery(labelName)}"`;

      const threads =
        GmailApp.search(
          query,
          0,
          maxThreadsPerLabel
        );


      for (const thread of threads) {

        const messages =
          thread.getMessages();


        for (const message of messages) {

          const messageId =
            message.getId();

          const recordKey =
            `${messageId}::${labelName}`;


          /*
           * Already processed?
           */

          if (existingKeys.has(recordKey)) {
            skipped++;
            continue;
          }


          try {

            const received =
              message.getDate();

            const receivedAt =
              received.toISOString();

            const receivedDate =
              Utilities.formatDate(
                received,
                DEFAULT_TIMEZONE,
                'yyyy-MM-dd'
              );


            /*
             * Parse sender
             */

            const sender =
              parseSender(
                message.getFrom()
              );


            /*
             * Get attachments
             */

            const attachments =
              message.getAttachments({
                includeInlineImages: false,
                includeAttachments: true
              });


            let senderFolder = null;
            const attachmentNames = [];


            /*
             * Only create Drive folders if
             * there are attachments.
             */

            if (attachments.length > 0) {

              /*
               * Folder:
               *
               * root/
               *   label/
               *     date/
               *       sender/
               */

              const labelFolder =
                getOrCreateChildFolder(
                  rootFolder,
                  sanitizeFolderName(labelName)
                );


              const dateFolder =
                getOrCreateChildFolder(
                  labelFolder,
                  receivedDate
                );


              senderFolder =
                getOrCreateChildFolder(
                  dateFolder,
                  sanitizeFolderName(
                    sender.name ||
                    sender.email ||
                    'Unknown Sender'
                  )
                );


              /*
               * Upload every Gmail attachment.
               */

              for (const attachment of attachments) {

                const originalName =
                  attachment.getName() ||
                  'attachment';


                /*
                 * copyBlob keeps the file data.
                 * setName explicitly preserves
                 * the original Gmail filename.
                 */

                const blob =
                  attachment.copyBlob()
                    .setName(originalName);


                senderFolder.createFile(blob);

                attachmentNames.push(
                  originalName
                );

                attachmentsUploaded++;
              }
            }


            /*
             * --------------------------------
             * Write successful email to Sheet
             * --------------------------------
             *
             * This happens only AFTER attachments
             * have uploaded successfully.
             */

            sheet.appendRow([
              recordKey,
              messageId,
              receivedAt,
              receivedDate,
              sender.name,
              sender.email,
              message.getSubject() || '(No Subject)',
              labelName,
              attachments.length,
              attachmentNames.join(', '),
              senderFolder
                ? senderFolder.getId()
                : '',
              senderFolder
                ? senderFolder.getUrl()
                : '',
              'PROCESSED',
              new Date().toISOString()
            ]);


            /*
             * Mark the record as existing during
             * this same execution.
             */

            existingKeys.add(recordKey);


            /*
             * Add visual processed label.
             *
             * Note:
             * Gmail labels are thread based,
             * while actual deduplication uses
             * Message ID + monitored label.
             */

            thread.addLabel(processedLabel);


            processed++;

          } catch (messageError) {

            console.error(
              'Message processing failed',
              messageId,
              messageError
            );

            errors.push({
              label: labelName,
              message_id: messageId,
              error:
                messageError.message ||
                String(messageError)
            });
          }
        }
      }

    } catch (labelError) {

      console.error(
        'Label processing failed',
        labelName,
        labelError
      );

      errors.push({
        label: labelName,
        error:
          labelError.message ||
          String(labelError)
      });
    }
  }


  SpreadsheetApp.flush();


  /*
   * If ANY individual item failed,
   * success = false.
   *
   * n8n's Validate Response node will
   * deliberately fail the workflow,
   * causing the Error Workflow to fire.
   */

  return {
    success: errors.length === 0,

    processed: processed,

    attachments_uploaded:
      attachmentsUploaded,

    skipped: skipped,

    errors: errors,

    error:
      errors.length > 0
        ? `${errors.length} Gmail item(s) failed`
        : null,

    timestamp:
      new Date().toISOString()
  };
}


/**
 * ================================================================
 * WORKFLOW 2
 * Telegram Receipt -> Gemini -> Drive -> Sheets
 * ================================================================
 *
 * Gemini processing stays in n8n.
 *
 * Apps Script receives:
 *
 * - Gemini's structured receipt values
 * - receipt image as Base64
 *
 * Then Apps Script:
 *
 * - saves image to Drive
 * - records result in Sheets
 *
 * ================================================================
 */

function saveReceipt(payload) {

  const receipt =
    payload.receipt || {};


  const rootFolderName =
    payload.drive_root_folder_name ||
    'n8n Receipt Images';


  const spreadsheetName =
    payload.spreadsheet_name ||
    'n8n Receipt Automation';


  const sheetName =
    payload.sheet_name ||
    'Receipts';


  /*
   * --------------------------------
   * Receipt values
   * --------------------------------
   */

  const merchantName =
    receipt.merchant_name ||
    null;

  const transactionDate =
    normalizeDate(
      receipt.transaction_date
    );

  const totalAmount =
    normalizeNumber(
      receipt.total_amount
    );

  const currency =
    receipt.currency ||
    null;

  const receiptNumber =
    receipt.receipt_number ||
    null;

  const paymentMethod =
    receipt.payment_method ||
    null;


  /*
   * --------------------------------
   * Telegram metadata
   * --------------------------------
   */

  const telegramChatId =
    payload.telegram_chat_id != null
      ? String(payload.telegram_chat_id)
      : '';

  const telegramMessageId =
    payload.telegram_message_id != null
      ? String(payload.telegram_message_id)
      : '';


  /*
   * Unique receipt key.
   *
   * Best option is Telegram:
   * chat ID + message ID
   */

  let recordKey = '';

  if (
    telegramChatId &&
    telegramMessageId
  ) {
    recordKey =
      `telegram:${telegramChatId}:${telegramMessageId}`;
  }


  /*
   * --------------------------------
   * Prepare Sheet
   * --------------------------------
   */

  const sheet =
    getOrCreateSheet(
      spreadsheetName,
      sheetName,
      [
        'Record Key',
        'Submission At',
        'Transaction Date',
        'Merchant Name',
        'Total Amount',
        'Currency',
        'Receipt Number',
        'Payment Method',
        'Telegram Chat ID',
        'Telegram Message ID',
        'Original File Name',
        'Drive File ID',
        'Drive File URL',
        'Status'
      ]
    );


  /*
   * Avoid duplicate Telegram submission.
   */

  if (recordKey) {

    const existingKeys =
      getExistingKeys(sheet);

    if (existingKeys.has(recordKey)) {

      return {
        success: true,
        duplicate: true,
        message:
          'Receipt was already processed',
        record_key: recordKey
      };
    }
  }


  /*
   * --------------------------------
   * Process image
   * --------------------------------
   */

  if (!payload.image_base64) {
    throw new Error(
      'image_base64 is required for save_receipt'
    );
  }


  const mimeType =
    payload.mime_type ||
    'image/jpeg';


  const originalFileName =
    payload.file_name ||
    generateReceiptFilename(
      transactionDate,
      mimeType
    );


  const imageBytes =
    decodeBase64(
      payload.image_base64
    );


  const imageBlob =
    Utilities.newBlob(
      imageBytes,
      mimeType,
      originalFileName
    );


  /*
   * --------------------------------
   * Drive folder structure
   *
   * n8n Receipt Images/
   *   2026-08-30/
   *      original-image.jpg
   * --------------------------------
   */

  const rootFolder =
    getOrCreateRootFolder(
      rootFolderName
    );


  /*
   * Prefer receipt transaction date.
   * Otherwise use current Manila date.
   */

  const driveDate =
    transactionDate ||
    Utilities.formatDate(
      new Date(),
      DEFAULT_TIMEZONE,
      'yyyy-MM-dd'
    );


  const dateFolder =
    getOrCreateChildFolder(
      rootFolder,
      driveDate
    );


  const file =
    dateFolder.createFile(
      imageBlob
    );


  /*
   * --------------------------------
   * Write receipt to Sheets
   * --------------------------------
   */

  sheet.appendRow([
    recordKey,
    new Date().toISOString(),
    transactionDate || '',
    merchantName || '',
    totalAmount != null
      ? totalAmount
      : '',
    currency || '',
    receiptNumber || '',
    paymentMethod || '',
    telegramChatId,
    telegramMessageId,
    originalFileName,
    file.getId(),
    file.getUrl(),
    'PROCESSED'
  ]);


  SpreadsheetApp.flush();


  return {
    success: true,

    duplicate: false,

    merchant_name:
      merchantName,

    transaction_date:
      transactionDate,

    total_amount:
      totalAmount,

    currency:
      currency,

    receipt_number:
      receiptNumber,

    payment_method:
      paymentMethod,

    drive_file_id:
      file.getId(),

    drive_file_url:
      file.getUrl(),

    spreadsheet_name:
      spreadsheetName,

    sheet_name:
      sheetName,

    timestamp:
      new Date().toISOString()
  };
}


/**
 * ================================================================
 * SECURITY
 * ================================================================
 */

function validateSecret(receivedSecret) {

  const expectedSecret =
    PropertiesService
      .getScriptProperties()
      .getProperty('API_SECRET');


  if (!expectedSecret) {
    throw new Error(
      'API_SECRET is not configured in Apps Script Script Properties'
    );
  }


  if (!receivedSecret) {
    throw new Error(
      'Missing API secret'
    );
  }


  if (
    String(receivedSecret) !==
    String(expectedSecret)
  ) {
    throw new Error(
      'Unauthorized request'
    );
  }
}


/**
 * ================================================================
 * GOOGLE DRIVE HELPERS
 * ================================================================
 */

function getOrCreateRootFolder(name) {

  const folders =
    DriveApp.getFoldersByName(name);


  if (folders.hasNext()) {
    return folders.next();
  }


  return DriveApp.createFolder(name);
}


function getOrCreateChildFolder(
  parentFolder,
  name
) {

  const folders =
    parentFolder.getFoldersByName(name);


  if (folders.hasNext()) {
    return folders.next();
  }


  return parentFolder.createFolder(name);
}


function sanitizeFolderName(value) {

  const result =
    String(value || 'Unknown')
      .replace(/[\/\\]/g, '-')
      .replace(/[\r\n\t]/g, ' ')
      .trim();


  return result || 'Unknown';
}


/**
 * ================================================================
 * GOOGLE SHEETS HELPERS
 * ================================================================
 */

function getOrCreateSheet(
  spreadsheetName,
  sheetName,
  expectedHeaders
) {

  let spreadsheet = null;


  /*
   * Search Drive for an existing spreadsheet.
   */

  const files =
    DriveApp.getFilesByName(
      spreadsheetName
    );


  while (files.hasNext()) {

    const file =
      files.next();


    if (
      file.getMimeType() ===
      MimeType.GOOGLE_SHEETS
    ) {
      spreadsheet =
        SpreadsheetApp.openById(
          file.getId()
        );

      break;
    }
  }


  /*
   * Create spreadsheet if missing.
   */

  if (!spreadsheet) {

    spreadsheet =
      SpreadsheetApp.create(
        spreadsheetName
      );
  }


  /*
   * Get/create tab.
   */

  let sheet =
    spreadsheet.getSheetByName(
      sheetName
    );


  if (!sheet) {

    sheet =
      spreadsheet.insertSheet(
        sheetName
      );
  }


  /*
   * Initialize column headings.
   */

  if (sheet.getLastRow() === 0) {

    sheet
      .getRange(
        1,
        1,
        1,
        expectedHeaders.length
      )
      .setValues([
        expectedHeaders
      ]);


    sheet.setFrozenRows(1);
  }


  /*
   * Protect against accidentally pointing
   * this automation at an unrelated sheet.
   */

  const actualHeaders =
    sheet
      .getRange(
        1,
        1,
        1,
        expectedHeaders.length
      )
      .getValues()[0];


  for (
    let i = 0;
    i < expectedHeaders.length;
    i++
  ) {

    if (
      actualHeaders[i] !==
      expectedHeaders[i]
    ) {

      throw new Error(
        `Unexpected sheet structure in "${spreadsheetName}" / "${sheetName}". ` +
        `Expected column ${i + 1} to be "${expectedHeaders[i]}".`
      );
    }
  }


  return sheet;
}


function getExistingKeys(sheet) {

  const keys =
    new Set();


  const lastRow =
    sheet.getLastRow();


  if (lastRow <= 1) {
    return keys;
  }


  const values =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        1
      )
      .getValues();


  for (const row of values) {

    const value =
      String(
        row[0] || ''
      ).trim();


    if (value) {
      keys.add(value);
    }
  }


  return keys;
}


/**
 * ================================================================
 * GMAIL HELPERS
 * ================================================================
 */

function getOrCreateGmailLabel(name) {

  let label =
    GmailApp.getUserLabelByName(name);


  if (!label) {
    label =
      GmailApp.createLabel(name);
  }


  return label;
}


function escapeGmailQuery(value) {

  return String(value)
    .replace(/"/g, '\\"');
}


function parseSender(fromValue) {

  const raw =
    String(fromValue || '').trim();


  /*
   * Example:
   *
   * John Smith <john@example.com>
   */

  const match =
    raw.match(
      /^(.*?)\s*<([^>]+)>$/
    );


  if (match) {

    const name =
      String(match[1] || '')
        .replace(/^["']|["']$/g, '')
        .trim();


    const email =
      String(match[2] || '')
        .trim();


    return {
      name:
        name ||
        email.split('@')[0] ||
        'Unknown Sender',

      email: email
    };
  }


  /*
   * Plain email address.
   */

  if (raw.includes('@')) {

    return {
      name:
        raw.split('@')[0],

      email: raw
    };
  }


  return {
    name:
      raw ||
      'Unknown Sender',

    email: ''
  };
}


/**
 * ================================================================
 * RECEIPT HELPERS
 * ================================================================
 */

function normalizeDate(value) {

  if (!value) {
    return null;
  }


  const text =
    String(value).trim();


  /*
   * Gemini should already return YYYY-MM-DD.
   */

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(text)
  ) {
    return text;
  }


  const parsed =
    new Date(text);


  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return null;
  }


  return Utilities.formatDate(
    parsed,
    DEFAULT_TIMEZONE,
    'yyyy-MM-dd'
  );
}


function normalizeNumber(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }


  if (
    typeof value === 'number'
  ) {
    return value;
  }


  const cleaned =
    String(value)
      .replace(/,/g, '')
      .replace(/[^\d.-]/g, '');


  const number =
    Number(cleaned);


  return Number.isFinite(number)
    ? number
    : null;
}


function decodeBase64(input) {

  let base64 =
    String(input || '').trim();


  /*
   * Supports:
   *
   * data:image/jpeg;base64,/9j/4AA...
   *
   * as well as plain Base64.
   */

  const commaIndex =
    base64.indexOf(',');


  if (
    base64.startsWith('data:') &&
    commaIndex !== -1
  ) {
    base64 =
      base64.substring(
        commaIndex + 1
      );
  }


  try {

    return Utilities.base64Decode(
      base64
    );

  } catch (error) {

    /*
     * Fallback for URL-safe Base64.
     */

    return Utilities.base64DecodeWebSafe(
      base64
    );
  }
}


function generateReceiptFilename(
  transactionDate,
  mimeType
) {

  let extension = 'jpg';


  if (
    mimeType === 'image/png'
  ) {
    extension = 'png';
  }

  else if (
    mimeType === 'image/webp'
  ) {
    extension = 'webp';
  }

  else if (
    mimeType === 'application/pdf'
  ) {
    extension = 'pdf';
  }


  const date =
    transactionDate ||
    Utilities.formatDate(
      new Date(),
      DEFAULT_TIMEZONE,
      'yyyy-MM-dd'
    );


  const timestamp =
    Utilities.formatDate(
      new Date(),
      DEFAULT_TIMEZONE,
      'HHmmss'
    );


  return (
    `receipt_${date}_${timestamp}.${extension}`
  );
}


/**
 * ================================================================
 * RESPONSE HELPER
 * ================================================================
 */

function jsonResponse(data) {

  return ContentService
    .createTextOutput(
      JSON.stringify(data)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}