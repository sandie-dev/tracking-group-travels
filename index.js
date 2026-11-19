import express from "express";
import pg from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, timingSafeEqual } from "node:crypto";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const { Pool } = pg;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const isProduction = process.env.NODE_ENV === "production";
const cookieSecret =
  process.env.SESSION_SECRET ||
  (isProduction ? null : "local-development-only-change-this-secret");

if (!process.env.PG_DATABASE_URL) {
  console.warn("PG_DATABASE_URL is not set. Database requests will fail until it is configured.");
}

if (isProduction && !cookieSecret) {
  throw new Error("SESSION_SECRET must be configured in Netlify environment variables.");
}

const pool = new Pool({
  connectionString: process.env.PG_DATABASE_URL,
  // This matches the SSL approach in your original project.
  // Prefer your database provider's CA certificate verification if it supplies one.
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

const COOKIE_NAME = "travel_tracker_user";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

const allowedColors = new Set([
  "red", "green", "yellow", "olive", "orange",
  "teal", "blue", "violet", "purple", "pink", "powderblue",
]);

function createUserSignature(userId) {
  return createHmac("sha256", cookieSecret)
    .update(String(userId))
    .digest("hex");
}

function readSelectedUserId(req) {
  const cookieHeader = req.headers.cookie || "";
  const cookiePair = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${COOKIE_NAME}=`));

  if (!cookiePair) return null;

  let value;
  try {
    value = decodeURIComponent(cookiePair.slice(COOKIE_NAME.length + 1));
  } catch {
    return null;
  }

  const [userId, signature] = value.split(".");
  if (!/^\d+$/.test(userId || "") || !signature) return null;

  const expected = createUserSignature(userId);
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  return Number(userId);
}

function setSelectedUserCookie(res, userId) {
  const value = encodeURIComponent(`${userId}.${createUserSignature(userId)}`);
  const options = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(COOKIE_MAX_AGE / 1000)}`,
  ];

  if (isProduction) options.push("Secure");

  res.setHeader("Set-Cookie", options.join("; "));
}

async function getUsers() {
  const result = await pool.query(
    "SELECT id, name, color FROM users ORDER BY id"
  );
  return result.rows;
}

async function getSelectedUser(req, users) {
  const requestedId = readSelectedUserId(req);
  let selected = users.find((user) => Number(user.id) === requestedId);

  if (!selected) selected = users[0];

  if (selected && Number(selected.id) !== requestedId) {
    // A missing or invalid cookie defaults to the first available family member.
    // The caller sets the cookie on the response.
  }

  return selected || null;
}

async function getVisitedCountries(userId) {
  const result = await pool.query(
    `SELECT country_code
     FROM visited_countries
     WHERE user_id = $1
     ORDER BY country_code`,
    [userId]
  );

  return result.rows.map((row) => row.country_code);
}

async function renderHome(res, user, users, error = null, status = 200) {
  if (!user) {
    return res.status(status).render("new.ejs", {
      error: error || "Add your first family member to get started.",
    });
  }

  const countries = await getVisitedCountries(user.id);

  return res.status(status).render("index.ejs", {
    countries,
    total: countries.length,
    users,
    color: user.color,
    error,
  });
}

app.get("/", async (req, res) => {
  try {
    const users = await getUsers();

    if (users.length === 0) {
      return res.render("new.ejs", {
        error: "Add your first family member to get started.",
      });
    }

    const selectedUser = await getSelectedUser(req, users);
    if (readSelectedUserId(req) !== Number(selectedUser.id)) {
      setSelectedUserCookie(res, selectedUser.id);
    }

    return await renderHome(res, selectedUser, users);
  } catch (error) {
    console.error("Unable to load the home page:", error);
    return res.status(500).send("Unable to load Travel Tracker. Please check the database connection.");
  }
});

app.post("/add", async (req, res) => {
  try {
    const users = await getUsers();
    const selectedUser = await getSelectedUser(req, users);

    if (!selectedUser) {
      return res.status(400).render("new.ejs", {
        error: "Add a family member before adding countries.",
      });
    }
    if (readSelectedUserId(req) !== Number(selectedUser.id)) {
      setSelectedUserCookie(res, selectedUser.id);
    }

    const input = String(req.body.country || "").trim();

    if (!input) {
      return await renderHome(
        res, selectedUser, users,
        "Please enter a country name.", 400
      );
    }

    const countryResult = await pool.query(
      `SELECT country_code
       FROM countries
       WHERE LOWER(country_name) LIKE '%' || LOWER($1) || '%'
       ORDER BY country_name
       LIMIT 1`,
      [input]
    );

    if (countryResult.rows.length === 0) {
      return await renderHome(
        res, selectedUser, users,
        "Country not found. Please try again.", 400
      );
    }

    const countryCode = countryResult.rows[0].country_code;

    const alreadyVisited = await pool.query(
      `SELECT 1
       FROM visited_countries
       WHERE user_id = $1 AND country_code = $2
       LIMIT 1`,
      [selectedUser.id, countryCode]
    );

    if (alreadyVisited.rows.length > 0) {
      return await renderHome(
        res, selectedUser, users,
        "That country is already on this family member's list.", 400
      );
    }

    await pool.query(
      `INSERT INTO visited_countries (country_code, user_id)
       VALUES ($1, $2)`,
      [countryCode, selectedUser.id]
    );

    return res.redirect("/");
  } catch (error) {
    console.error("Error adding country:", error);
    return res.status(500).send("Unable to add that country. Please try again.");
  }
});

app.post("/user", async (req, res) => {
  try {
    if (req.body.add === "new") {
      return res.render("new.ejs", { error: null });
    }

    const userId = Number(req.body.user);
    if (!Number.isInteger(userId) || userId < 1) {
      return res.redirect("/");
    }

    const result = await pool.query(
      "SELECT id FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.redirect("/");
    }

    setSelectedUserCookie(res, userId);
    return res.redirect("/");
  } catch (error) {
    console.error("Error switching family member:", error);
    return res.status(500).send("Unable to switch family member.");
  }
});

app.post("/new", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const color = String(req.body.color || "").trim().toLowerCase();

    if (!name) {
      return res.status(400).render("new.ejs", {
        error: "Please enter a name.",
      });
    }

    if (name.length > 100) {
      return res.status(400).render("new.ejs", {
        error: "Please use a name with 100 characters or fewer.",
      });
    }

    if (!allowedColors.has(color)) {
      return res.status(400).render("new.ejs", {
        error: "Please choose one of the available colours.",
      });
    }

    const result = await pool.query(
      "INSERT INTO users (name, color) VALUES ($1, $2) RETURNING id",
      [name, color]
    );

    const newUserId = result.rows[0].id;
    setSelectedUserCookie(res, newUserId);

    return res.redirect("/");
  } catch (error) {
    console.error("Error creating family member:", error);
    return res.status(500).send("Unable to create the family member. Please try again.");
  }
});

app.use((req, res) => {
  res.status(404).send("Page not found.");
});

export default app;
