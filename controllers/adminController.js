const usersDb = require('../services/database/users');

function serializeUser(user) {
    return {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt
    };
}

async function listUsers(req, res) {
    const users = await usersDb.list();
    res.json({ users: users.map(serializeUser) });
}

async function setAdmin(req, res) {
    const isAdmin = !!(req.body || {}).isAdmin;
    if (String(req.params.id) === String(req.session.userId) && !isAdmin) {
        return res.status(400).json({ error: "You can't remove your own admin access" });
    }
    const user = await usersDb.update(req.params.id, { isAdmin });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(serializeUser(user));
}

async function removeUser(req, res) {
    if (String(req.params.id) === String(req.session.userId)) {
        return res.status(400).json({ error: "You can't delete your own account" });
    }
    const user = await usersDb.remove(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
}

module.exports = { listUsers, setAdmin, removeUser };
