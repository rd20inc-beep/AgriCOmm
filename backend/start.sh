#!/bin/sh
set -e

echo "Running migrations..."
npx knex migrate:latest

# Check if users table is empty (first run = needs seeding)
# Use tail -1 to get just the number, ignoring dotenv log lines
USER_COUNT=$(node -e "
const db = require('./src/config/database');
db('users').count('* as c').first().then(r => {
  console.log(r.c);
  db.destroy();
}).catch(() => { console.log('0'); db.destroy(); });
" 2>/dev/null | tail -1 || echo "0")

echo "User count detected: $USER_COUNT"

if [ "$USER_COUNT" = "0" ] || [ -z "$USER_COUNT" ]; then
  echo "Empty database detected. Running seeds..."
  npx knex seed:run
else
  echo "Database already has $USER_COUNT users. Skipping seeds."
fi

echo "Starting server..."
node src/server.js
