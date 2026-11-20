import fs from 'node:fs';
fs.mkdirSync('dist/lib',{recursive:true});
for (const file of ['index.html','styles.css','landing-agentflow-v1.css','app-theme-v2.css','typography-neue-haas.css','copy-paste-v1.css','clipboard-import.js','matching.js','mix-compatibility.js','beatport-export.js','lib/playlist-model.js','app.js']) fs.copyFileSync(file,'dist/'+file);
console.log('CRATEFLOW static site built in dist/');
