import {loadContent, validateContent} from '../src/content.mjs';
import {ROOT, build} from './build.mjs';
try {
  const release=process.argv.includes('--release');
  const data=await loadContent(ROOT);
  validateContent(data,{release});
  const report=await build();
  console.log(`Content valid. Production-filtered build: ${report.routes.length} routes, ${report.assetFiles} media files.`);
  if(!release) console.log('This checks the implementation, not publication approval. Run npm run release:check before any deployment.');
} catch(error) {console.error(`Check failed: ${error.message}`);process.exitCode=1;}
