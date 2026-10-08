const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('@lwc/compiler');
let count = 0;
for (const name of ['tapToPayCollector', 'tapToPayConfig']) {
  const folder = path.join('force-app/main/default/lwc', name);
  for (const file of fs.readdirSync(folder)) {
    if (!/\.(js|html|css)$/.test(file)) continue;
    const source = fs.readFileSync(path.join(folder, file), 'utf8');
    const result = transformSync(source, file, { name, namespace: 'c', apiVersion: 67 });
    const errors = (result.warnings || []).filter(w => w.level === 1);
    if (errors.length) throw new Error(JSON.stringify(errors));
    count++;
  }
}
console.log(`Compiled ${count} LWC source files successfully.`);
