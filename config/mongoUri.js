// Builds a MongoDB connection string. Credentials are optional so the bundled
// Docker Mongo container (internal network only, no auth) and an external
// authenticated MongoDB instance can share the same code path.
const buildMongoUri = () => {
    const { MONGO_URI, mongoUser, mongoPass, mongoHost, mongoPort, mongoDBName } = process.env;
    // Set directly, used as-is instead of the mongoHost/etc block below —
    // needed for mongodb+srv:// hosts (e.g. MongoDB Atlas) that don't fit
    // the host:port shape the rest of this function builds.
    if (MONGO_URI) return MONGO_URI;

    const auth = mongoUser && mongoPass
        ? `${encodeURIComponent(mongoUser)}:${encodeURIComponent(mongoPass)}@`
        : '';
    return `mongodb://${auth}${mongoHost}:${mongoPort}/${mongoDBName}`;
};

module.exports = buildMongoUri;
