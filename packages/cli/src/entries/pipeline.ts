import { runPipeline } from "../pipeline.js";

const urls = process.argv.slice(2);
if (urls.length === 0) { console.error("Usage: npm run pipeline <URL1> [URL2] ..."); process.exit(1); }
runPipeline(urls).catch(console.error);
