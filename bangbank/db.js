//shane1
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Password123!',
    database: 'fyp_project',
});

module.exports = pool;