import "dotenv/config";
import { scrapeCourse } from "../scraper/index.js";

const url = process.argv[2];
if (!url) { console.error("Usage: npm run scrape <URL>"); process.exit(1); }
scrapeCourse(url).then((c) => console.log("완료:", c.title)).catch(console.error);
