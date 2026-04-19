#!/usr/bin/env python3
"""Fix the startup code in index.html for Phase 3 async initDB."""
with open('index.html', 'r') as f:
    html = f.read()

old = """document.addEventListener('DOMContentLoaded',()=>{
  App.launch();
  setTimeout(()=>Sync.init(), 200);
});"""

new = """document.addEventListener('DOMContentLoaded', async ()=>{
  await initDB(SEED);
  App.launch();
  await Sync.init();
  if(navigator.serviceWorker){navigator.serviceWorker.addEventListener('message',(e)=>{if(e.data&&e.data.type==='sync-push')Sync.push();});}
});"""

if old in html:
    html = html.replace(old, new)
    with open('index.html', 'w') as f:
        f.write(html)
    print("SUCCESS: Startup code updated for Phase 3 async initDB")
else:
    print("ERROR: Could not find the expected startup code block")
