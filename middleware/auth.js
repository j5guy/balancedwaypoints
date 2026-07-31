const requireAuth = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/auth/login?redirect=' + encodeURIComponent(req.originalUrl));
};

const requireApiAuth = (req, res, next) => {
    if (req.session.userId) return next();
    res.status(401).json({ error: 'Not authenticated' });
};

const requireAdmin = (req, res, next) => {
    if (req.session.isAdmin) return next();
    res.status(403).render('error', { message: 'Admin access required' });
};

const requireApiAdmin = (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    if (req.session.isAdmin) return next();
    res.status(403).json({ error: 'Admin access required' });
};

module.exports = { requireAuth, requireApiAuth, requireAdmin, requireApiAdmin };
