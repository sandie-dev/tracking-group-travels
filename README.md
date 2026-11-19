# Travel Tracker 

## What changed
- Keeps Express 4 and EJS.
- Exports the Express app from `index.js` instead of starting it there.
- Adds `netlify/functions/api.js` using `serverless-http`.
- Adds Netlify routing and Node.js 22 configuration.
- Uses PostgreSQL `Pool` and a signed, HTTP-only cookie to keep each visitor's selected family member separate.
- Removes unused `body-parser` and `fs` dependencies.

## Requirements
- Node.js 22
- A PostgreSQL database with the tables/columns already used by the original project:
  - `users (id, name, color)`
  - `countries (country_code, country_name)`
  - `visited_countries (country_code, user_id)`

No database schema or existing records are changed by these application files.

## Run locally
1. Open this folder in your terminal.
2. Run `npm install` (this generates a fresh `package-lock.json`).
3. Copy `.env.example` to `.env`.
4. Put your real PostgreSQL connection string in `PG_DATABASE_URL`.
5. Set `SESSION_SECRET` to a long random value.
6. Run `npm start`.
7. Open `http://localhost:3000`.

Do not upload `.env` or commit it to Git.

## Deploy to Netlify
1. Push the project to the Git repository connected to Netlify.
2. In Netlify, open **Project configuration → Environment variables**.
3. Add `PG_DATABASE_URL` using the connection string from your PostgreSQL provider.
4. Add `SESSION_SECRET` using a long random secret.
5. Set `NODE_ENV` to `production`.
6. Set the site's base directory to the folder containing `package.json` if it is not the repository root.
7. Deploy. The included `netlify.toml` sets the publish directory and Functions directory.

## Important database SSL note
The current production pool configuration uses `rejectUnauthorized: false` to match the original project setup and support common hosted PostgreSQL services. If your database provider supplies a CA certificate, use that certificate for full TLS certificate verification instead.

## Important
The ZIP does not include your database, database credentials, or a database schema export. The code assumes the same table and column names used by your original `index.js`. Test with your existing database before changing any schema.
