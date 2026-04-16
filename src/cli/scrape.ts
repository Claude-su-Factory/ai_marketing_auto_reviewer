import "dotenv/config";
import { scrapeProduct } from "../scraper/index.js";

const url = process.argv[2];
if (!url) { console.error("Usage: npm run scrape <URL>"); process.exit(1); }
scrapeProduct(url).then((p) => console.log("완료:", p.name)).catch(console.error);
