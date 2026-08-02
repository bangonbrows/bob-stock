const { chromium } = require('playwright');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const url = 'file:///' + repo.replace(/\\/g, '/') + '/index.html';
const authKeys = ['sellAtSupply', 'discAtSupply', 'pricingVersion', 'catalogueVersion'];
const wireKeys = ['SellAtSupply', 'DiscAtSupply', 'PricingVersion', 'CatalogueVersion'];

function noAuth(o) {
  return authKeys.every(k => !Object.prototype.hasOwnProperty.call(o || {}, k));
}

function noWireAuth(o) {
  return wireKeys.every(k => !Object.prototype.hasOwnProperty.call(o || {}, k));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ timezoneId: 'Australia/Perth' });
  const page = await context.newPage();

  try {
    await page.route('**logic.azure.com**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"ok":true,"items":[]}'
    }));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() =>
      typeof DB !== 'undefined' &&
      typeof window.Transfer !== 'undefined' &&
      typeof Pages !== 'undefined' &&
      typeof Sync !== 'undefined',
      { timeout: 20000 }
    );
    await page.waitForTimeout(1200);

    const result = await page.evaluate(() => {
      const auth = ['sellAtSupply', 'discAtSupply', 'pricingVersion', 'catalogueVersion'];
      const hasAuth = o => auth.some(k => Object.prototype.hasOwnProperty.call(o || {}, k));
      const fullAuth = o => auth.every(k => o && o[k] != null);
      const noAuth = o => auth.every(k => !Object.prototype.hasOwnProperty.call(o || {}, k));
      const wire = ['SellAtSupply', 'DiscAtSupply', 'PricingVersion', 'CatalogueVersion'];
      const noWire = o => wire.every(k => !Object.prototype.hasOwnProperty.call(o || {}, k));

      const d = DB.get();
      const office = (d.stores || []).find(s => s && s.active && s.isFranchise && s.isFranchiseOffice);
      const product = (d.products || []).find(p => p && p.active && typeof p.price === 'number' && Number.isFinite(p.price));
      if (!office || !product) throw new Error('fixture requires an active franchise office and priced product');

      const bogusSell = Number(Math.min(999999.99, (product.price || 0) + 123.45).toFixed(2));
      const officeDisc = Number.isFinite(Number(office.franchiseDiscount)) ? Number(office.franchiseDiscount) : 0;
      const bogusDisc = officeDisc === 31 ? 32 : 31;
      const originalPricingConfig = d.pricingConfig;
      const originalCatalogueVersion = localStorage.getItem('bob_catalogue_version');

      const receiveTransfer = {
        id: 'qa_partial_receive',
        fromStoreId: 'head_office',
        toStoreId: office.id,
        date: '2026-07-19T04:00:00.000Z',
        submittedAt: '2026-07-19T04:00:00.000Z',
        createdAt: '2026-07-18T04:00:00.000Z',
        status: 'in_transit',
        items: [{
          productId: product.id,
          sentQty: 1,
          sellAtSupply: bogusSell,
          discAtSupply: bogusDisc,
          basis: 'submit-stamped'
        }]
      };
      d.pricingConfig = { version: 77, global: {}, stores: {} };
      localStorage.setItem('bob_catalogue_version', '88');
      Transfer._stampAtReceive(receiveTransfer);
      d.pricingConfig = originalPricingConfig;
      if (originalCatalogueVersion == null) localStorage.removeItem('bob_catalogue_version');
      else localStorage.setItem('bob_catalogue_version', originalCatalogueVersion);

      const partialTransfer = {
        id: 'qa_partial_item',
        fromStoreId: 'head_office',
        toStoreId: office.id,
        date: '2026-07-19T04:00:00.000Z',
        submittedAt: '2026-07-19T04:00:00.000Z',
        createdAt: '2026-07-18T04:00:00.000Z',
        status: 'in_transit',
        items: [{
          productId: product.id,
          sentQty: 1,
          sellAtSupply: bogusSell,
          discAtSupply: bogusDisc,
          basis: 'submit-stamped'
        }]
      };

      const inheritedRow = {
        id: 'qa_inherited_partial',
        type: 'transfer_in',
        qty: 1,
        storeId: office.id,
        productId: product.id,
        transferId: partialTransfer.id,
        date: '2026-07-19',
        createdAt: '2026-07-19T05:00:00.000Z'
      };
      Transfer._stampTxns(partialTransfer, [inheritedRow]);
      const submitPayload = Transfer._submitPayload(partialTransfer, []);
      const resolutionPayload = Transfer._enrichResolutions(partialTransfer, [{ productId: product.id, action: 'accept' }]);

      const partialItemRow = {
        id: 'qa_invoice_partial_item',
        type: 'transfer_in',
        qty: 1,
        storeId: office.id,
        productId: product.id,
        transferId: partialTransfer.id,
        date: '2026-07-19',
        createdAt: '2026-07-19T05:00:00.000Z'
      };
      const partialRow = {
        id: 'qa_invoice_partial_row',
        type: 'transfer_in',
        qty: 1,
        storeId: office.id,
        productId: product.id,
        transferId: 'qa_full_transfer',
        date: '2026-07-20',
        createdAt: '2026-07-20T05:00:00.000Z',
        sellAtSupply: bogusSell
      };
      const fullTransfer = {
        id: 'qa_full_transfer',
        fromStoreId: 'head_office',
        toStoreId: office.id,
        items: [{
          productId: product.id,
          sellAtSupply: 50,
          discAtSupply: 25,
          pricingVersion: 7,
          catalogueVersion: 8,
          basis: 'submit-stamped'
        }]
      };
      const fullItemRow = {
        id: 'qa_invoice_full_item',
        type: 'transfer_in',
        qty: 1,
        storeId: office.id,
        productId: product.id,
        transferId: fullTransfer.id,
        date: '2026-07-21',
        createdAt: '2026-07-21T05:00:00.000Z'
      };
      const invoice = Pages._franchiseInvoiceData({
        stores: [{ ...office, active: true, isFranchise: true, isFranchiseOffice: true }],
        products: [{ ...product, id: product.id, active: true, price: 999 }],
        transfers: [partialTransfer, fullTransfer],
        transactions: [partialItemRow, partialRow, fullItemRow],
        deletedTransactions: []
      }, '2026-07-01', '2026-07-31');
      const lines = invoice.length ? invoice[0].lines : [];
      const lineByDate = date => lines.find(l => l.date === date) || null;

      const syncPartial = Sync._toSharePoint({
        id: 'qa_sync_partial',
        date: '2026-07-19',
        storeId: office.id,
        productId: product.id,
        type: 'transfer_in',
        qty: 1,
        sellAtSupply: bogusSell,
        discAtSupply: bogusDisc
      });
      const syncFull = Sync._toSharePoint({
        id: 'qa_sync_full',
        date: '2026-07-19',
        storeId: office.id,
        productId: product.id,
        type: 'transfer_in',
        qty: 1,
        sellAtSupply: 50,
        discAtSupply: 25,
        pricingVersion: 7,
        catalogueVersion: 8
      });
      const wirePartialIngest = Sync._fromSharePoint({
        TransactionId: 'qa_wire_partial',
        Date: '2026-07-19',
        StoreId: office.id,
        ProductId: product.id,
        Type: 'transfer_in',
        Qty: 1,
        StaffName: 'QA',
        Reason: 'Received from Head Office',
        DeviceId: 'qa',
        TransferId: 'qa_wire_partial_transfer',
        Timestamp: Date.parse('2026-07-19T05:00:00.000Z'),
        SellAtSupply: bogusSell,
        DiscAtSupply: bogusDisc
      });
      const wireAbsentIngest = Sync._fromSharePoint({
        TransactionId: 'qa_wire_absent',
        Date: '2026-07-19',
        StoreId: office.id,
        ProductId: product.id,
        Type: 'transfer_in',
        Qty: 1,
        StaffName: 'QA',
        Reason: 'Received from Head Office',
        DeviceId: 'qa',
        TransferId: 'qa_wire_absent_transfer',
        Timestamp: Date.parse('2026-07-19T05:00:00.000Z')
      });
      const archivePartialIngest = Sync._fromArchive({
        SourceId: 123,
        TransactionId: 'qa_archive_partial',
        TxnDate: '2026-07-19',
        StoreId: office.id,
        ProductId: product.id,
        TxnType: 'transfer_in',
        Qty: 1,
        StaffName: 'QA',
        Reason: 'Received from Head Office',
        DeviceId: 'qa',
        TransferId: 'qa_archive_partial_transfer',
        TxnTimestamp: Date.parse('2026-07-19T05:00:00.000Z'),
        SellAtSupply: bogusSell,
        DiscAtSupply: bogusDisc
      });
      const archiveAbsentIngest = Sync._fromArchive({
        SourceId: 124,
        TransactionId: 'qa_archive_absent',
        TxnDate: '2026-07-19',
        StoreId: office.id,
        ProductId: product.id,
        TxnType: 'transfer_in',
        Qty: 1,
        StaffName: 'QA',
        Reason: 'Received from Head Office',
        DeviceId: 'qa',
        TransferId: 'qa_archive_absent_transfer',
        TxnTimestamp: Date.parse('2026-07-19T05:00:00.000Z')
      });

      return {
        receiveItem: receiveTransfer.items[0],
        receiveItemFull: fullAuth(receiveTransfer.items[0]),
        receiveItemChanged: receiveTransfer.items[0].sellAtSupply !== bogusSell || receiveTransfer.items[0].discAtSupply !== bogusDisc,
        receiveItemUsedSourceVersions: receiveTransfer.items[0].pricingVersion === 77 && receiveTransfer.items[0].catalogueVersion === 88,
        inheritedRowNoAuth: noAuth(inheritedRow),
        submitPayloadNoAuth: noAuth(submitPayload.items[0]),
        resolutionPayloadNoAuth: noAuth(resolutionPayload[0]),
        partialItemLine: lineByDate('2026-07-19'),
        partialRowLine: lineByDate('2026-07-20'),
        fullItemLine: lineByDate('2026-07-21'),
        syncPartialNoWireAuth: noWire(syncPartial),
        syncFull,
        wirePartialRejected: wirePartialIngest === null,
        wireAbsentNoAuth: wireAbsentIngest && !hasAuth(wireAbsentIngest),
        archivePartialRejected: archivePartialIngest === null,
        archiveAbsentNoAuth: archiveAbsentIngest && !hasAuth(archiveAbsentIngest)
      };
    });

    const checks = {
      receivePartialRemintedFull: result.receiveItemFull && result.receiveItemChanged && result.receiveItem.basis === 'receive-stamped',
      receiveRemintUsedSourceVersions: result.receiveItemUsedSourceVersions,
      rowPartialNoInheritedAuth: result.inheritedRowNoAuth,
      submitPayloadPartialNoAuth: result.submitPayloadNoAuth,
      resolutionPayloadPartialNoAuth: result.resolutionPayloadNoAuth,
      invoicePartialItemClosed: result.partialItemLine && result.partialItemLine.lineErr === 'STAMP_ERROR' && result.partialItemLine.rateSource == null,
      invoicePartialRowClosed: result.partialRowLine && result.partialRowLine.lineErr === 'STAMP_ERROR' && result.partialRowLine.rateSource == null,
      invoiceFullItemStillBills: result.fullItemLine && result.fullItemLine.rateSource === 'transfer-stamped' && result.fullItemLine.lineErr == null,
      wirePartialShipsNoAuthority: result.syncPartialNoWireAuth,
      wireFullShipsLiteralAuthority: result.syncFull && result.syncFull.SellAtSupply === 50 && result.syncFull.DiscAtSupply === 25 && result.syncFull.PricingVersion === 7 && result.syncFull.CatalogueVersion === 8,
      wirePartialIngestRejected: result.wirePartialRejected,
      wireAbsentIngestNoAuthority: result.wireAbsentNoAuth,
      archivePartialIngestRejected: result.archivePartialRejected,
      archiveAbsentIngestNoAuthority: result.archiveAbsentNoAuth
    };

    console.log(JSON.stringify({
      checks,
      receiveItem: {
        sellAtSupply: result.receiveItem.sellAtSupply,
        discAtSupply: result.receiveItem.discAtSupply,
        pricingVersion: result.receiveItem.pricingVersion ?? null,
        catalogueVersion: result.receiveItem.catalogueVersion ?? null,
        basis: result.receiveItem.basis
      },
      partialItemLine: result.partialItemLine && {
        rateSource: result.partialItemLine.rateSource,
        lineErr: result.partialItemLine.lineErr
      },
      partialRowLine: result.partialRowLine && {
        rateSource: result.partialRowLine.rateSource,
        lineErr: result.partialRowLine.lineErr
      },
      fullItemLine: result.fullItemLine && {
        rateSource: result.fullItemLine.rateSource,
        lineErr: result.fullItemLine.lineErr
      },
      syncFull: {
        SellAtSupply: result.syncFull.SellAtSupply,
        DiscAtSupply: result.syncFull.DiscAtSupply,
        PricingVersion: result.syncFull.PricingVersion,
        CatalogueVersion: result.syncFull.CatalogueVersion
      }
    }, null, 2));

    if (!Object.values(checks).every(Boolean)) {
      throw new Error('one or more partial authority tuple checks failed');
    }
    console.log('STAMP-BEHAVIOUR ROUND4 CHECK: PASS');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
