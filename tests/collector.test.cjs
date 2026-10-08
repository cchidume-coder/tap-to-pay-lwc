const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(service = {}) {
  let source = fs.readFileSync('force-app/main/default/lwc/tapToPayCollector/tapToPayCollector.js', 'utf8');
  source = source.replace(/^import .*;\n/gm, '').replace(/@wire\([^\n]+\)\n/g, '').replace(/@(api|track)\s+/g, '').replace('export default class', 'class');
  const timers = new Map(); let timerId = 0;
  const config = { merchantAccountId: 'test-merchant', merchantName: 'Test', currencyIsoCode: 'USD', countryIsoCode: 'US', taxRatePercent: 8.25, paymentTimeoutMs: 90000, availabilityTimeoutMs: 30000 };
  const ctx = { CONFIG: config, ACCOUNT_ID_FIELD: 'AccountId', WORK_ORDER_NUMBER_FIELD: 'WorkOrderNumber', getPaymentsService: () => service, getFieldValue: (data, key) => data[key], LightningElement: class { dispatchEvent() {} }, ShowToastEvent: class {}, setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id) };
  vm.createContext(ctx);
  vm.runInContext(source + '\nthis.Collector = TapToPayCollector;', ctx);
  const c = new ctx.Collector(); c.payerAccountIdValue = 'test-payer'; c.connectedCallback();
  return { c, timers };
}
const tick = async () => { for (let n=0; n<8; n++) await Promise.resolve(); };
function checkout(service) { const env = setup({ isAvailable: () => true, ...service }); env.c.amountValue = 7.75; env.c.methodChecked = true; env.c.step = 'checkout'; return env; }
test('tax is 8.25% and 18% tip uses pre-tax subtotal', () => {
  const { c } = checkout(); assert.equal(c.taxAmount, 0.64); assert.equal(c.tipAmount, 1.4); assert.equal(c.total, 9.79);
});
test('no tip and custom tip calculate total; negative and nonfinite tips block Pay', () => {
  const { c } = checkout(); c.tipPercent = 0; assert.equal(c.total, 8.39);
  c.showCustomTip = true; c.customTipAmount = 2; assert.equal(c.total, 10.39);
  for (const invalid of [-1, Infinity, 'bad']) { c.customTipAmount = invalid; assert.equal(c.payDisabled, true); }
});
test('Next requires amount, configured merchant, and supported method', async () => {
  const { c } = setup({ isAvailable: () => true, getSupportedPaymentMethods: async () => ['TAP_TO_PAY'] });
  c.amountValue = 10; assert.equal(c.nextDisabled, true); await c.handleBeginSupportedMethodCheck(); assert.equal(c.nextDisabled, false);
  c.merchantAccountIdValue = ''; assert.equal(c.nextDisabled, true);
  c.merchantAccountIdValue = 'test'; for (const invalid of [0, -1, Infinity, 'bad', 1.234]) { c.amountValue = invalid; assert.equal(c.nextDisabled, true); }
});
test('Pay sends grand total and attribution once, handles success', async () => {
  const calls = []; const { c } = checkout({ collectPayment: async options => { calls.push(options); return { status: 'success', guid: 'confirmation' }; } });
  c.recordId = 'work-order'; c.payerAccountIdValue = 'payer'; c.handleCollectPayment(); c.handleCollectPayment(); await tick();
  assert.equal(calls.length, 1); assert.equal(calls[0].amount, 9.79); assert.equal(calls[0].paymentMethod, 'TAP_TO_PAY'); assert.equal(calls[0].sourceObjectIds[0], 'work-order'); assert.equal(c.step, 'done'); assert.equal(c.spinnerEnabled, false);
});
test('sync bridge failure clears spinner', async () => {
  const { c } = checkout({ collectPayment: () => { throw { code: 'USER_DISMISSED' }; } }); c.handleCollectPayment(); await tick(); assert.equal(c.spinnerEnabled, false); assert.match(c.paymentsServiceResponse, /canceled/);
});
test('timeout blocks retry, then a late success updates the outcome', async () => {
  let resolve; const { c, timers } = checkout({ collectPayment: () => new Promise(r => { resolve = r; }) });
  c.handleCollectPayment(); await tick(); [...timers.values()][0](); assert.equal(c.spinnerEnabled, false); assert.equal(c.outcomeUnknown, true); assert.equal(c.payDisabled, true);
  resolve({ status: 'success' }); await tick(); assert.equal(c.step, 'done'); assert.equal(c.outcomeUnknown, false);
});
test('unknown and failed result do not show success', () => {
  const { c } = checkout(); c.processResult({ status: 'failed' }); assert.equal(c.step, 'checkout');
  c.processResult({}); assert.equal(c.outcomeUnknown, true); assert.equal(c.payDisabled, true); c.handleVerifiedUnpaid(); assert.equal(c.methodChecked, false);
});
test('availability timeout recovers and unsupported method keeps Next disabled', async () => {
  const { c, timers } = setup({ isAvailable: () => true, getSupportedPaymentMethods: () => new Promise(() => {}) });
  const check = c.handleBeginSupportedMethodCheck(); [...timers.values()][0](); await check; assert.equal(c.spinnerEnabled, false); assert.equal(c.methodChecked, false);
});
test('disconnect invalidates late callbacks', async () => {
  let resolve; const { c } = checkout({ collectPayment: () => new Promise(r => { resolve = r; }) }); c.handleCollectPayment(); await tick(); c.disconnectedCallback(); resolve({ status: 'success' }); await tick(); assert.equal(c.step, 'checkout');
});
