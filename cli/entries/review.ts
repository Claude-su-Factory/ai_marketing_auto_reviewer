import "dotenv/config";
import { runReviewSession } from "../reviewer/session.js";
runReviewSession().catch(console.error);
