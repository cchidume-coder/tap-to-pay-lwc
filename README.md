# Tap to Pay Collector

A standalone Work Order payment collector for Salesforce Field Service mobile: enter an amount, verify Tap to Pay, review tax and a customer-selected tip, then launch the native reader.

This repository is independent of the original invoice-connected `fieldServiceTapToPay` implementation. It uses **`tapToPayCollector`** and **`WorkOrder.Collect_Tap_to_Pay`** to avoid overwriting the original component or action. It contains no invoice Apex, invoice objects, org authentication, or recipient-specific merchant IDs.

## Checkout

- Amount and currency entry followed by Tap-to-Pay verification.
- 15%, 18% (initial selection), 20%, no tip, or a custom monetary tip.
- Tips calculated from the **pre-tax subtotal**.
- Configurable flat sales tax, default **8.25%**. This is demo/application configuration, not a connection to a Salesforce TaxPolicy or Stripe Tax engine.
- Itemized subtotal, tax, tip, and total. For 7.75 with 18% tip, tax is 0.64, tip is 1.40, total is 9.79.
- The final amount, including tip and tax, is passed to `collectPayment`. Tip and tax are not persisted as separate invoice or ledger entries.
- Availability check timeout: 30 seconds. Payment response timeout: 90 seconds.
- A payment timeout means **outcome unknown**, not failed. It releases the spinner and blocks Pay. Check Salesforce PaymentIntent and Stripe before acknowledging an unpaid attempt. A late native response can still update the outcome.

## Configure before deploying

Edit [`tapToPayConfig.js`](force-app/main/default/lwc/tapToPayConfig/tapToPayConfig.js):

```js
merchantAccountId: '',           // Your Salesforce MerchantAccount ID
merchantName: 'Salesforce Payments',
countryIsoCode: 'US',
currencyIsoCode: 'USD',
taxRatePercent: 8.25,
```

The Merchant Account ID is intentionally blank. Payment actions stay disabled until configured. Use your own onboarded native Salesforce Payments account, with the associated gateway configured for your intended environment. This module works for quick actions too: `lightning__RecordAction` does not support configurable component properties in App Builder.

Amounts currently use two decimal places. Currency choices do not imply that the merchant supports every listed currency. Confirm country, currency, and device support for the recipient merchant.

## Install

Prerequisites: Salesforce CLI, an authenticated org with Work Orders, native Salesforce Payments and the appropriate Field Service/mobile payment permissions and licenses. No Apex class or custom invoice object is required.

```bash
git clone <repository-url>
cd tap-to-pay-lwc
# Configure tapToPayConfig.js before deployment.
sf org login web --alias recipient-org
sf project deploy start --target-org recipient-org --source-dir force-app
```

Add **Collect Tap to Pay** to the Work Order action configuration used by your Field Service mobile app. The component also exposes a Work Order record-page target. Test the actual Field Service action placement with your app/version; general Salesforce mobile and mobile web are not equivalent to Field Service mobile. In a browser the component shows an unavailable message.

Ensure the mobile user can read WorkOrder.AccountId and WorkOrder.WorkOrderNumber. Associate the Work Order with the customer Account before collecting a payment. The public collectPayment reference identifies payerAccountId as required, although the shipped type definitions mark it optional; this asset requires the Work Order Account to avoid relying on that discrepancy.

## Native Payments setup checklist

1. **Before creating the Merchant Account, check Setup → Company Information and complete/correct the company address.** In the original implementation, correcting this address before creating a new Merchant Account resulted in its PaymentGateway receiving a provisioned Tap-to-Pay location. This is an observed setup lesson, not proof that every existing account must be recreated.
2. Complete native Payments merchant onboarding for the desired Test/Live environment.
3. Inspect the associated PaymentGateway, including MerchantAccountId, PaymentStatus, GatewayMode, and DefaultTapToPayLocation. The original native gateways used Status=Complete / PaymentStatus=Enabled; do not force an Apex-adapter status or provider linkage solely to match a different integration model.
4. Verify DefaultTapToPayLocation is populated on the **gateway**. It may be null on MerchantAccount while present on PaymentGateway. Direct updates were rejected in the original org; consult supported Payments setup/support procedures rather than assuming a generic sync button exists.
5. Confirm merchant environment and Terminal location environment match. For Test mode use the supported Stripe Terminal test/simulation procedure for your device integration. A typed web test PAN is not automatically a physical NFC test card.
6. Use a supported physical device with the Salesforce Field Service app, device location permission, and suitable connectivity. Verify current device/OS requirements in the linked Salesforce docs.
7. Run `isAvailable()` → `getSupportedPaymentMethods()` → `collectPayment()` and verify the actual result.

## Troubleshooting and payment reconciliation

The module uses `paymentMethod: 'TAP_TO_PAY'`. A resolved result is shown as completed only when status is `success` (case-insensitive). Unexpected/empty statuses require reconciliation rather than showing a success screen.

Native payment attempts can appear as **PaymentIntent** records even when ApexLog, PaymentGatewayLog, PaymentAuthorization, and Payment are empty. Missing Apex logs do not prove no request reached Salesforce. Investigate PaymentIntent alongside Stripe's test/live dashboard.

```sql
SELECT PaymentIntentNumber, Status, IntentAmount, EntryMode,
       MerchantAccountId, PaymentGatewayId, ProviderReference, CreatedDate
FROM PaymentIntent
WHERE CreatedDate = TODAY
ORDER BY CreatedDate DESC
```

Failed intents identify failed attempts; consult Stripe/the returned error for the cause. A Failed status alone does not prove a specific card decline reason. A timeout cannot establish whether the card was charged. Do not retry until the attempt is reconciled.

## Optional invoice integration

Keep invoice dependencies outside this standalone core. A recipient can build a wrapper/controller that resolves their own invoice balance and payment reconciliation rules. The original implementation used `TapToPayInvoiceController` and an org-specific `SDO_Sales_Invoice_Example__c` schema; those files are intentionally excluded. Avoid applying tax again to an invoice balance that already includes tax.

## Development and validation

Requires Node.js 20 or newer.

```bash
npm ci
npm test
npm run validate
```

Tests exercise the component controller with platform stubs: calculations, availability gating, final payment payload, duplicate-click prevention, synchronous errors, timeouts, late results, and disconnect cleanup. Compiler validation checks the actual LWC JS, template, and CSS. These checks do not simulate the physical reader or replace an on-device payment test. No Salesforce org is modified by these commands.

## References

- [PaymentsService workflow](https://developer.salesforce.com/docs/platform/mobile-offline/guide/use-paymentsservice-in-a-lightning-component.html)
- [collectPayment options](https://developer.salesforce.com/docs/platform/lwc/guide/reference-lightning-paymentsservice-collectpayment.html)
- [Record action configuration](https://developer.salesforce.com/docs/platform/lwc/guide/targets-lightning-record-action.html)
- [Stripe Terminal testing](https://docs.stripe.com/terminal/references/testing)

## License

License selection is pending. This repository is private for review. No open-source license has been granted yet; choose a license before public release intended for reuse. See [LICENSE-OPTIONS.md](LICENSE-OPTIONS.md).
