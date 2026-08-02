const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() =>
      typeof Pages !== 'undefined' &&
      typeof Transfer !== 'undefined' &&
      typeof Sync !== 'undefined' &&
      typeof DB !== 'undefined'
    );

    const result = await page.evaluate(async () => {
      const product = { id: 'qa_product', name: 'QA Product', price: 100, franchiseDiscount: 25, active: true };
      const office = {
        id: 'qa_franchise_office', name: 'QA Franchise Office', active: true,
        isFranchise: true, isFranchiseOffice: true, franchiseDiscount: 25
      };

      Pricing.lensActive = () => false;
      const missingTransferRow = {
        id: 'qa_missing_transfer_row', date: '2026-07-19', storeId: office.id,
        productId: product.id, type: 'transfer_in', qty: 1,
        transferId: 'qa_transfer_not_present_yet',
        reason: 'Received from Head Office North'
      };
      const invoiceFixture = {
        stores: [office], products: [product], transactions: [missingTransferRow],
        deletedTransactions: [], transfers: []
      };
      const missingTransferOrigin = Pages._isHOSupply(missingTransferRow, invoiceFixture);
      const missingTransferLines = Pages._franchiseInvoiceData(
        invoiceFixture, '2026-07-01', '2026-07-31'
      ).flatMap(x => x.lines).length;

      const directFixture = {
        stores: [office], products: [product], transactions: [],
        deletedTransactions: [], transfers: [], pricingConfig: { version: 11 }
      };
      let captured = null;
      DB.get = () => directFixture;
      DB.addTransactionDurable = async (txn) => {
        captured = JSON.parse(JSON.stringify(txn));
        directFixture.transactions.push(captured);
        return true;
      };
      DB.commit = () => {};
      Pricing.lensActive = () => true;
      Pricing.rateAsOf = () => ({ rate: 25, source: 'qa' });
      Transfer._pricingSubmitGate = () => ({ ok: true });
      Stock.isConsumableProduct = () => false;
      Stock.qty = () => 999;
      Stock.alerts = () => [];
      UI.todayLocal = () => '2026-07-19';
      UI.toast = () => {};
      UI.fatalSaveError = () => {};
      Pages._renderLogStep = () => {};
      Pages._renderTodayMovements = () => {};
      Pages._getLogStoreId = () => office.id;
      localStorage.setItem('bob_catalogue_version', '7');
      Pages._logData = {
        type: 'in', productId: product.id, qty: 2, staffName: 'QA Reviewer',
        reason: 'Direct HO supply', stockFromStoreId: 'head_office',
        stockFrom: 'HO Warehouse', stockToStoreId: office.id,
        stockTo: 'Franchise Office'
      };
      await Pages._submitLog();
      const directWire = Sync._toSharePoint(captured);
      const directPulled = Sync._fromSharePoint(Object.assign({ ID: 1 }, directWire));
      const directInvoiceLine = Pages._franchiseInvoiceData(
        directFixture, '2026-07-01', '2026-07-31'
      ).flatMap(x => x.lines)[0] || null;

      const receiveFixture = {
        stores: [office], products: [product], transactions: [], transfers: [],
        pricingConfig: { version: 12 }
      };
      DB.get = () => receiveFixture;
      Pricing.lensActive = () => true;
      const draftCreatedAt = '2026-07-01T00:00:00.000Z';
      const submittedAt = '2026-07-15T00:00:00.000Z';
      const boundary = Date.parse('2026-07-10T00:00:00.000Z');
      let rateLookupMs = null;
      Pricing.rateAsOf = (_storeId, _productId, ms) => {
        rateLookupMs = ms;
        return { rate: ms < boundary ? 10 : 30, source: 'qa' };
      };
      const staleDraftSubmit = {
        id: 'qa_stale_draft_submit', fromStoreId: 'head_office', toStoreId: office.id,
        createdAt: draftCreatedAt, date: submittedAt,
        items: [{ productId: product.id, sentQty: 1 }]
      };
      Transfer._stampAtReceive(staleDraftSubmit);

      const flatString = '2026-07-19T00:00:00.000Z';
      const flatArray = ['qa_b', 'qa_a'];
      const oldSerialize = (value) => JSON.stringify(value, Object.keys(value).sort());

      return {
        missingTransfer: {
          classifiedAsHO: missingTransferOrigin,
          invoiceLineCount: missingTransferLines
        },
        directLog: {
          local: {
            sellAtSupply: captured && captured.sellAtSupply,
            discAtSupply: captured && captured.discAtSupply,
            pricingVersion: captured && captured.pricingVersion,
            catalogueVersion: captured && captured.catalogueVersion
          },
          wire: {
            sellAtSupply: directWire.SellAtSupply,
            discAtSupply: directWire.DiscAtSupply,
            pricingVersion: directWire.PricingVersion,
            catalogueVersion: directWire.CatalogueVersion
          },
          pulled: {
            pricingVersion: directPulled && directPulled.pricingVersion,
            catalogueVersion: directPulled && directPulled.catalogueVersion
          },
          localInvoice: {
            lineErr: directInvoiceLine && directInvoiceLine.lineErr,
            rateSource: directInvoiceLine && directInvoiceLine.rateSource,
            owed: directInvoiceLine && directInvoiceLine.owed
          }
        },
        stampAtReceive: {
          lookupInstant: new Date(rateLookupMs).toISOString(),
          draftCreatedAt,
          submittedAt,
          stampedDiscount: staleDraftSubmit.items[0].discAtSupply,
          expectedSubmitDayDiscount: 30
        },
        stableHashFlatEquivalence: {
          stringSerializedEqual: oldSerialize(flatString) === Records._canonicalSerialize(flatString),
          stringHashEqual: Records._fnv(oldSerialize(flatString)) === Records._stableHash(flatString),
          arraySerializedEqual: oldSerialize(flatArray) === Records._canonicalSerialize(flatArray),
          arrayHashEqual: Records._fnv(oldSerialize(flatArray)) === Records._stableHash(flatArray)
        }
      };
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
