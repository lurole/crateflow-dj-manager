import fs from 'node:fs';
fs.mkdirSync('dist',{recursive:true});
for (const file of ['index.html','styles.css','landing-agentflow-v1.css','app-theme-v2.css','typography-v1.css','matching.js','app.js']) fs.copyFileSync(file,'dist/'+file);
console.log('CRATEFLOW static site built in dist/');
