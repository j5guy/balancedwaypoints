// Builds a MongoDB connection string. Credentials are optional so the bundled
// Docker Mongo container (internal network only, no auth) and an external
// authenticated MongoDB instance can share the same code path.
const buildMongoUri = () => {
    const { mongoUser, mongoPass, mongoHost, mongoPort, mongoDBName } = process.env;
    const auth = mongoUser && mongoPass
        ? `${encodeURIComponent(mongoUser)}:${encodeURIComponent(mongoPass)}@`
        : '';
    return `mongodb://${auth}${mongoHost}:${mongoPort}/${mongoDBName}`;
};

module.exports = buildMongoUri;
