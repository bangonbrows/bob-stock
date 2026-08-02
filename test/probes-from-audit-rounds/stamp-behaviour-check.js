const { chromium } = require('playwright');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const url = 'file:///' + repo.replace(/\\/g, '/') + '/index.html';

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
      typeof Pages !== 'undefined',
      { timeout: 20000 }
    );
    await page.waitForTimeout(1200);

    const result = await page.evaluate(() => {
      const d = DB.get();
      const office = (d.stores || []).find(s => s && s.active && s.isFranchise && s.isFranchiseOffice);
      const product = (d.products || []).find(p => p && p.active && typeof p.price === 'number');
      if (!office || !product) throw new Error('fixture requires an active franchise office and priced product');

      const transfer = {
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
          sellAtSupply: 123.45,
          discAtSupply: 30,
          basis: 'submit-stamped'
        }]
      };

      Transfer._stampAtReceive(transfer);
      const receivedRow = {
        id: 'qa_receive_row',
        type: 'transfer_in',
        qty: 1,
        storeId: office.id,
        productId: product.id,
        transferId: transfer.id,
        date: '2026-07-19',
        createdAt: '2026-07-19T05:00:00.000Z'
      };
      Transfer._stampTxns(transfer, [receivedRow]);
      const submitPayload = Transfer._submitPayload(transfer, []);
      const resolutionPayload = Transfer._enrichResolutions(transfer, [{ productId: product.id, action: 'accept' }]);
      const syncPartial = Sync._toSharePoint({
        id: 'qa_sync_partial',
        date: '2026-07-19',
        storeId: office.id,
        productId: product.id,
        type: 'transfer_in',
        qty: 1,
        sellAtSupply: 123.45,
        discAtSupply: 30
      });
      const syncFull = Sync._toSharePoint({
        id: 'qa_sync_full',
        date: '2026-07-19',
        storeId: office.id,
        productId: product.id,
        type: 'transfer_in',
        qty: 1,
        sellAtSupply: 123.45,
        discAtSupply: 30,
        pricingVersion: 7,
        catalogueVersion: 8
      });

      const partialItemRow = {
        id: 'qa_invoice_partial_item',
        type: 'transfer_in',
        qty: 1,
        storeId: office.id,
        productId: product.id,
        transferId: transfer.id,
        date: '2026-07-19',
        createdAt: '2026-07-19T05:00:00.000Z'
      };
      const partialRow = {
        ...partialItemRow,
        id: 'qa_invoice_partial_row',
        sellAtSupply: 123.45
      };
      const fixture = {
        stores: [{ ...office, active: true, isFranchise: true, isFranchiseOffice: true }],
        products: [{ ...product, id: product.id, active: true, price: 999 }],
        transfers: [transfer],
        transactions: [partialItemRow, partialRow],
        deletedTransactions: []
      };
      const invoice = Pages._franchiseInvoiceData(fixture, '2026-07-01', '2026-07-31');
      const lines = invoice.length ? invoice[0].lines : [];
      const ghostRow = {
        id: 'qa_origin_no_record',
        type: 'transfer_in',
        qty: 1,
        storeId: office.id,
        productId: product.id,
        transferId: 'qa_missing_transfer',
        date: '2026-07-20',
        createdAt: '2026-07-20T05:00:00.000Z',
        reason: 'Received from Head Office',
        sellAtSupply: 50,
        discAtSupply: 25,
        pricingVersion: 1,
        catalogueVersion: 1
      };
      const originNoRecord = Pages._franchiseInvoiceData({
        stores: [{ ...office, active: true, isFranchise: true, isFranchiseOffice: true }],
        products: [{ ...product, id: product.id, active: true, price: 999 }],
        transfers: [],
        transactions: [ghostRow],
        deletedTransactions: []
      }, '2026-07-01', '2026-07-31');
      const originWithRecord = Pages._franchiseInvoiceData({
        stores: [{ ...office, active: true, isFranchise: true, isFranchiseOffice: true }],
        products: [{ ...product, id: product.id, active: true, price: 999 }],
        transfers: [{
          id: 'qa_missing_transfer',
          fromStoreId: 'head_office',
          toStoreId: office.id,
          items: [{
            productId: product.id,
            sellAtSupply: 50,
            discAtSupply: 25,
            pricingVersion: 1,
            catalogueVersion: 1,
            basis: 'submit-stamped'
          }]
        }],
        transactions: [ghostRow],
        deletedTransactions: []
      }, '2026-07-01', '2026-07-31');

      const originalPricingConfig = d.pricingConfig;
      const originalActivated = localStorage.getItem('bob_pricing_activated');
      const originalStale = localStorage.getItem('bob_pricing_stale');
      const originalUnresolved = localStorage.getItem('bob_pricing_unresolved');
      const originalConfAt = localStorage.getItem('bob_pricing_conf_at');
      localStorage.setItem('bob_pricing_activated', '1');
      localStorage.removeItem('bob_pricing_stale');
      localStorage.removeItem('bob_pricing_unresolved');
      localStorage.removeItem('bob_pricing_conf_at');
      d.pricingConfig = {
        version: 77,
        global: {},
        stores: {
          [office.id]: {
            [product.id]: [
              { from: '2026-07-01T00:00:00.000Z', to: '2026-07-02T00:00:00.000Z', rate: 25 },
              { from: '2026-07-02T00:00:00.000Z', to: '2026-07-03T00:00:00.000Z', rate: 30 },
              { from: '2026-07-03T00:00:00.000Z', to: null, rate: 45 }
            ]
          }
        }
      };
      const staleTransfer = {
        id: 'qa_submit_era',
        fromStoreId: 'head_office',
        toStoreId: office.id,
        date: '2026-07-02T12:00:00.000Z',
        submittedAt: '2026-07-02T12:00:00.000Z',
        createdAt: '2026-07-01T12:00:00.000Z',
        items: [{ productId: product.id, sentQty: 1 }]
      };
      Transfer._stampAtReceive(staleTransfer);
      const preW4Fold = Records.foldRecord([{
        recordType: 'transfer',
        recordId: 'qa_pre_w4_submit',
        stepType: 'submit',
        timestamp: '2026-07-02T12:34:56.000Z',
        fromStoreId: 'head_office',
        toStoreId: office.id,
        payload: {
          fromStoreId: 'head_office',
          toStoreId: office.id,
          type: 'standard',
          createdAt: '2026-07-01T12:00:00.000Z',
          items: [{
            productId: product.id,
            sentQty: 1,
            sellAtSupply: 11,
            discAtSupply: 30,
            pricingVersion: 77,
            catalogueVersion: 1,
            basis: 'submit-stamped'
          }]
        }
      }]);
      d.pricingConfig = originalPricingConfig;
      if (originalActivated == null) localStorage.removeItem('bob_pricing_activated'); else localStorage.setItem('bob_pricing_activated', originalActivated);
      if (originalStale == null) localStorage.removeItem('bob_pricing_stale'); else localStorage.setItem('bob_pricing_stale', originalStale);
      if (originalUnresolved == null) localStorage.removeItem('bob_pricing_unresolved'); else localStorage.setItem('bob_pricing_unresolved', originalUnresolved);
      if (originalConfAt == null) localStorage.removeItem('bob_pricing_conf_at'); else localStorage.setItem('bob_pricing_conf_at', originalConfAt);

      return {
        itemAfterReceive: transfer.items[0],
        inheritedRow: receivedRow,
        submitPayloadItem: submitPayload.items[0],
        resolutionPayloadItem: resolutionPayload[0],
        syncPartial,
        syncFull,
        partialItemInvoice: lines.find(l => l.date === partialItemRow.date && l.lineErr !== 'STAMP_ERROR') || null,
        partialRowInvoice: lines.find(l => l.lineErr === 'STAMP_ERROR') || null,
        originNoRecordLines: originNoRecord.length ? originNoRecord[0].lines : [],
        originWithRecordLines: originWithRecord.length ? originWithRecord[0].lines : [],
        staleTransferItem: staleTransfer.items[0],
        preW4SubmittedAt: preW4Fold && preW4Fold.submittedAt,
        lineCount: lines.length
      };
    });

    const itemPartial = result.itemAfterReceive.sellAtSupply === 123.45 &&
      result.itemAfterReceive.discAtSupply === 30 &&
      result.itemAfterReceive.pricingVersion == null &&
      result.itemAfterReceive.catalogueVersion == null;
    const rowFabricated = result.inheritedRow.pricingVersion === 0 &&
      result.inheritedRow.catalogueVersion === 0;
    const itemAccepted = result.partialItemInvoice &&
      result.partialItemInvoice.rateSource === 'transfer-stamped' &&
      result.partialItemInvoice.lineErr == null;
    const rowFailsClosed = result.partialRowInvoice &&
      result.partialRowInvoice.lineErr === 'STAMP_ERROR';
    const syncPartialShipsUnstamped = result.syncPartial &&
      !Object.prototype.hasOwnProperty.call(result.syncPartial, 'PricingVersion') &&
      !Object.prototype.hasOwnProperty.call(result.syncPartial, 'CatalogueVersion') &&
      !Object.prototype.hasOwnProperty.call(result.syncPartial, 'SellAtSupply') &&
      !Object.prototype.hasOwnProperty.call(result.syncPartial, 'DiscAtSupply');
    const syncFullShipsFour = result.syncFull &&
      result.syncFull.SellAtSupply === 123.45 &&
      result.syncFull.DiscAtSupply === 30 &&
      result.syncFull.PricingVersion === 7 &&
      result.syncFull.CatalogueVersion === 8;
    const submitPayloadFabricated = result.submitPayloadItem &&
      result.submitPayloadItem.pricingVersion === 0 &&
      result.submitPayloadItem.catalogueVersion === 0;
    const resolutionPayloadFabricated = result.resolutionPayloadItem &&
      result.resolutionPayloadItem.pricingVersion === 0 &&
      result.resolutionPayloadItem.catalogueVersion === 0;
    const missingRecordExcluded = Array.isArray(result.originNoRecordLines) &&
      result.originNoRecordLines.length === 0;
    const selfHealsWhenRecordArrives = Array.isArray(result.originWithRecordLines) &&
      result.originWithRecordLines.length === 1 &&
      result.originWithRecordLines[0].rateSource === 'stamped';
    const receiveUsesSubmitRate = result.staleTransferItem &&
      result.staleTransferItem.discAtSupply === 30;
    const preW4FoldUsesStepTimestamp = result.preW4SubmittedAt === '2026-07-02T12:34:56.000Z';

    console.log(JSON.stringify({
      itemPartial,
      rowFabricated,
      itemAccepted,
      rowFailsClosed,
      syncPartialShipsUnstamped,
      syncFullShipsFour,
      submitPayloadFabricated,
      resolutionPayloadFabricated,
      missingRecordExcluded,
      selfHealsWhenRecordArrives,
      receiveUsesSubmitRate,
      preW4FoldUsesStepTimestamp,
      itemAfterReceive: {
        sellAtSupply: result.itemAfterReceive.sellAtSupply,
        discAtSupply: result.itemAfterReceive.discAtSupply,
        pricingVersion: result.itemAfterReceive.pricingVersion ?? null,
        catalogueVersion: result.itemAfterReceive.catalogueVersion ?? null,
        basis: result.itemAfterReceive.basis
      },
      inheritedRow: {
        sellAtSupply: result.inheritedRow.sellAtSupply,
        discAtSupply: result.inheritedRow.discAtSupply,
        pricingVersion: result.inheritedRow.pricingVersion ?? null,
        catalogueVersion: result.inheritedRow.catalogueVersion ?? null
      },
      submitPayloadItem: {
        pricingVersion: result.submitPayloadItem.pricingVersion ?? null,
        catalogueVersion: result.submitPayloadItem.catalogueVersion ?? null
      },
      resolutionPayloadItem: {
        pricingVersion: result.resolutionPayloadItem.pricingVersion ?? null,
        catalogueVersion: result.resolutionPayloadItem.catalogueVersion ?? null
      },
      partialItemInvoice: result.partialItemInvoice && {
        sell: result.partialItemInvoice.sell,
        prodDisc: result.partialItemInvoice.prodDisc,
        rateSource: result.partialItemInvoice.rateSource,
        lineErr: result.partialItemInvoice.lineErr
      },
      partialRowInvoice: result.partialRowInvoice && {
        lineErr: result.partialRowInvoice.lineErr,
        rateSource: result.partialRowInvoice.rateSource
      },
      originNoRecordLineCount: result.originNoRecordLines.length,
      originWithRecordLineCount: result.originWithRecordLines.length,
      staleTransferItem: {
        discAtSupply: result.staleTransferItem.discAtSupply,
        basis: result.staleTransferItem.basis
      },
      preW4SubmittedAt: result.preW4SubmittedAt
    }, null, 2));

    if (!(itemPartial && rowFabricated && itemAccepted && rowFailsClosed &&
      syncPartialShipsUnstamped && syncFullShipsFour &&
      submitPayloadFabricated && resolutionPayloadFabricated &&
      missingRecordExcluded && selfHealsWhenRecordArrives &&
      receiveUsesSubmitRate && preW4FoldUsesStepTimestamp)) {
      throw new Error('expected partial-tuple behaviour was not reproduced');
    }
    console.log('STAMP-BEHAVIOUR CHECK: RESIDUAL CONFIRMED');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
