import serverless from "serverless-http";
import app from "../../index.js";

// Netlify rewrites /, /add, /user and /new through this function prefix.
export const handler = serverless(app, {
  basePath: "/.netlify/functions/api",
});
