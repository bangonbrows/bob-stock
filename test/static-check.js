const fs = require('fs'); 
const code1 = fs.readFileSync('../index.html', 'utf8'); 
const code2 = fs.readFileSync('../phase2.js', 'utf8'); 
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