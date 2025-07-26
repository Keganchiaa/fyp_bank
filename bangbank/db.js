const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Republic_C207',
    database: 'fyp_project',
});

module.exports = pool;