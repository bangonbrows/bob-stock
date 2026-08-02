const fs = require('fs');
const path = require('path');
// Resolve against THIS FILE, not the shell's working directory. These were bare '../' paths, so the
// gate crashed with ENOENT when run from the repo root — which is how HANDOVER documents every other
// gate. It only ever worked from inside test/, so anyone following the docs saw a crash and could
// reasonably read it as "the gate is broken" rather than "you are standing in the wrong folder".
const REPO = path.resolve(__dirname, '..');
const code1 = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const code2 = fs.readFileSync(path.join(REPO, 'phase2.js'), 'utf8');
const code = code1 + '\n' + code2; 

const matches = code.matchAll(/onclick=["']?([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\(/g); 
const missing = new Set(); 
for (const m of matches) { 
  const obj = m[1]; 
  const method = m[2]; 
  
  if (obj === 'Pages') { 
    if (!code1.includes(method + '(') && !code1.includes(method + ':')) missing.add('Pages.' + method); 
  } else if (obj === 'UI') { 
    if (!code1.includes(method + '(') && !code1.includes(method + ':') && !code1.includes(method + ' =')) missing.add('UI.' + method); 
  } else if (obj === 'TransferUI') { 
    if (!code2.includes(method + '(') && !code2.includes(method + ':') && !code2.includes(method + ' =')) missing.add('TransferUI.' + method); 
  } 
} 

console.log('Missing functions:', Array.from(missing));