import "dotenv/config";
import { launchCampaign } from "../launcher/index.js";
import { readJson, listJson } from "../storage.js";
import type { Creative, Course } from "../types.js";

const creativePaths = await listJson("data/creatives");
for (const p of creativePaths) {
  const creative = await readJson<Creative>(p);
  if (!creative || (creative.status !== "approved" && creative.status !== "edited")) continue;
  const course = await readJson<Course>(`data/courses/${creative.courseId}.json`);
  if (!course) continue;
  console.log(`게재 중: ${course.title}`);
  const campaign = await launchCampaign(course, creative);
  console.log(`완료: ${campaign.metaCampaignId}`);
}
