import "dotenv/config";
import { runReviewSession } from "../../cli/reviewer/session.js";
runReviewSession().catch(console.error);
