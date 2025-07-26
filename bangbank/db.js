const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '021006',
    database: 'fyp',
});

module.exports = pool;