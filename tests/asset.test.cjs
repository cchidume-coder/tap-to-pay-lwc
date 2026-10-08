const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(path.join(dir, item.name)) : [path.join(dir, item.name)]); }
test('deployable asset has no invoice controller or original component dependencies', () => {
  for (const file of files('force-app')) {
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /@salesforce\/apex|SDO_Sales_Invoice|fieldServiceTapToPay|swsequipment|8zbKa|tml_Gr/);
  }
  const action = fs.readFileSync('force-app/main/default/quickActions/WorkOrder.Collect_Tap_to_Pay.quickAction-meta.xml','utf8');
  assert.match(action, /<lightningWebComponent>tapToPayCollector<\/lightningWebComponent>/);
});
