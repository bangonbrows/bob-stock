/**
 * BOB Stock App — Legacy Data Migration Script (v2)
 * Migrates 595 transactions from GitHub JSON to SharePoint via push-v2 Logic App.
 *
 * Run from Azure Cloud Shell:
 *   export PUSH_URL="<push-v2 SAS URL>"
 *   node /tmp/migrate-v2.js
 *
 * The push-v2 Logic App expects:
 *   POST { data: { transactions: [ {TransactionId, Date, StoreId, ...}, ... ] } }
 *
 * This script:
 *   1. Reads the legacy bob-stock-data.json
 *   2. Maps each transaction from local camelCase to SharePoint PascalCase
 *   3. Sends in batches of 50 with 2-second delay between batches
 *   4. Logs progress every batch
 */

const fs = require('fs');
const https = require('https');
const http = require('http');
const url = require('url');

const PUSH_URL = process.env.PUSH_URL;
if (!PUSH_URL) {
  console.error('ERROR: PUSH_URL environment variable not set.');
  console.error('Usage: export PUSH_URL="<push-v2 SAS URL>" && node migrate-v2.js');
  process.exit(1);
}

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 2000;
const DATA_FILE = '/tmp/bob-stock2/data/bob-stock-data.json';

// ─── Field Mapping ─────────────────────────────────────────────────

function toSharePoint(t) {
  let ts = 0;
  if (typeof t.timestamp === 'number') {
    ts = t.timestamp;
  } else if (t.createdAt) {
    ts = new Date(t.createdAt).getTime();
  } else {
    ts = Date.now();
  }

  return {
    TransactionId: t.id,
    Date: t.date || '',
    StoreId: t.storeId || '',
    ProductId: t.productId || '',
    Type: t.type || '',
    Qty: typeof t.qty === 'number' ? t.qty : parseInt(t.qty, 10) || 0,
    StaffName: t.staffName || '',
    Reason: t.reason || '',
    DeviceId: 'migration_v2',
    Timestamp: ts,
    TransferId: t.transferId || ''
  };
}

// ─── HTTP POST helper ──────────────────────────────────────────────

function postJSON(targetUrl, payload) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;

    const body = JSON.stringify(payload);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ raw: data });
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  // 1. Read legacy data
  console.log(`Reading legacy data from ${DATA_FILE}...`);
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const data = JSON.parse(raw);
  const transactions = data.transactions || [];
  console.log(`Found ${transactions.length} transactions to migrate.`);

  if (transactions.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  // 2. Map all transactions to SharePoint format
  const spTransactions = transactions.map(toSharePoint);

  // Verify first record
  console.log('\nSample mapped transaction:');
  console.log(JSON.stringify(spTransactions[0], null, 2));

  // 3. Send in batches
  const totalBatches = Math.ceil(spTransactions.length / BATCH_SIZE);
  console.log(`\nSending ${spTransactions.length} transactions in ${totalBatches} batches of ${BATCH_SIZE}...`);

  let totalSent = 0;
  let totalFailed = 0;

  for (let i = 0; i < totalBatches; i++) {
    const start = i * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, spTransactions.length);
    const batch = spTransactions.slice(start, end);

    const payload = {
      data: {
        transactions: batch
      }
    };

    try {
      console.log(`\nBatch ${i + 1}/${totalBatches}: sending ${batch.length} transactions (${start + 1}-${end})...`);
      const result = await postJSON(PUSH_URL, payload);
      console.log(`  ✓ Batch ${i + 1} succeeded:`, JSON.stringify(result));
      totalSent += batch.length;
    } catch (err) {
      console.error(`  ✗ Batch ${i + 1} FAILED:`, err.message);
      totalFailed += batch.length;
    }

    // Delay between batches (except after the last one)
    if (i < totalBatches - 1) {
      console.log(`  Waiting ${BATCH_DELAY_MS}ms before next batch...`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  // 4. Summary
  console.log('\n════════════════════════════════════════');
  console.log(`Migration complete.`);
  console.log(`  Total transactions: ${spTransactions.length}`);
  console.log(`  Successfully sent:  ${totalSent}`);
  console.log(`  Failed:             ${totalFailed}`);
  console.log('════════════════════════════════════════');

  if (totalFailed > 0) {
    console.log('\n⚠ Some batches failed. Check the logs above and re-run for failed batches.');
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
