const { Client } = require('pg');

const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: 'postgres', // Connect to default DB to create a new one
    password: process.env.PGPASSWORD || 'admin123',
    port: process.env.PGPORT || 5432,
});

client.connect()
    .then(() => {
        console.log("Connected to 'postgres' database. Attempting to create 'internet_storage'...");
        return client.query('CREATE DATABASE internet_storage');
    })
    .then(() => {
        console.log("Successfully created database 'internet_storage'!");
    })
    .catch((err) => {
        if (err.code === '42P04') { // Database already exists
            console.log("Database 'internet_storage' already exists.");
        } else {
            console.error("Error creating database:", err);
        }
    })
    .finally(() => {
        client.end();
    });
