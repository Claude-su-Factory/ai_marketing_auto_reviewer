import "dotenv/config";
import { runReviewSession } from "../reviewer/index.js";
runReviewSession().catch(console.error);
