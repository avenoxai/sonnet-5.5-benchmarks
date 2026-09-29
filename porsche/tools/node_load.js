// Loads core.js + geo.js into a Node global (used by numeric tests). Usage: const PG = require('./node_load.js');
globalThis.window = globalThis;
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['js/core.js', 'js/geo.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
module.exports = globalThis.PG;
