import http from 'node:http';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const column = process.env.FIXTURE_VERSION === 'old' ? 'legacy_name' : 'display_name';
http.createServer(async (_request, response) => {
  try {
    const result = await pool.query(`SELECT ${column} AS name FROM release_names ORDER BY id`);
    response.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({version:process.env.FIXTURE_VERSION,rows:result.rows}));
  } catch (error) {
    response.writeHead(500, {'content-type':'application/json'}).end(JSON.stringify({version:process.env.FIXTURE_VERSION,code:error.code}));
  }
}).listen(8080, '0.0.0.0');
