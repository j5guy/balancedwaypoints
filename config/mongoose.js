require('dotenv').config();
const mongoose = require('mongoose');
const buildMongoUri = require('./mongoUri');

const mongooseConnect = async () => {
    try {
        await mongoose.connect(buildMongoUri());
        console.log('✅ MongoDB Connected Using Mongoose');
    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        process.exit(1);
    }
};

module.exports = mongooseConnect;
