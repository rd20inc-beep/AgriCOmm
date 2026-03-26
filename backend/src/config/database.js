const knex = require('knex');
const config = require('./index');

const db = knex({
  client: 'pg',
  connection: {
    host: config.db.host,
    port: config.db.port,
    database: config.db.name,
    user: config.db.user,
    password: config.db.password,
  },
  pool: {
    min: 2,
    max: 10,
    afterCreate: (conn, done) => {
      conn.query('SET search_path TO public;', (err) => {
        done(err, conn);
      });
    },
  },
  acquireConnectionTimeout: 10000,
});

module.exports = db;
