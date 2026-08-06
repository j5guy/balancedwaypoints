process.env.TZ = 'America/New_York';
require('dotenv').config();

const express = require('express');
const path = require('path');
const methodOverride = require('method-override');
const morgan = require('morgan');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

global.appRoot = path.resolve(__dirname);

const app = express();
const { webFQDN, webPort, appName } = require('./config/config');
const logger = require('./utils/logger');
const mongooseConnect = require('./config/mongoose');
const sessionConfig = require('./middleware/session');
const buildInfo = require('./utils/buildInfo');
const themeColorFields = require('./utils/themeColorFields');
const startScheduler = require('./services/schedules/scheduler');

// Database
mongooseConnect();

// Background jobs (schedule auto-entry — see services/schedules/scheduler.js)
startScheduler();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', true);

// Security headers. CSP is nonce-based: no inline scripts, no eval.
app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
});
const helmetMiddleware = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
            styleSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'none'"],
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
        }
    }
});
app.use(helmetMiddleware);

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing & method override
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '2mb' }));
app.use(methodOverride('_method'));
app.use(cookieParser());

// HTTP logging
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// Session
app.use(sessionConfig);

// Expose common view locals
app.use((req, res, next) => {
    res.locals.appName = appName;
    res.locals.path = req.path;
    res.locals.buildInfo = buildInfo;
    res.locals.isAuthenticated = !!req.session.userId;
    res.locals.isAdmin = !!req.session.isAdmin;
    res.locals.themeColors = req.session.themeColors || null;
    res.locals.themeColorFields = themeColorFields;
    next();
});

// Routes
const { doubleCsrfProtection } = require('./middleware/csrf');
const { apiBaselineLimiter } = require('./middleware/rateLimit');
const pagesRoutes = require('./routes/pages');
const authPagesRoutes = require('./routes/authPages');
const adminPagesRoutes = require('./routes/admin');
const authApiRoutes = require('./routes/api/auth');
const accountApiRoutes = require('./routes/api/account');
const accountsApiRoutes = require('./routes/api/accounts');
const accountSharesApiRoutes = require('./routes/api/accountShares');
const payeesApiRoutes = require('./routes/api/payees');
const categoriesApiRoutes = require('./routes/api/categories');
const categoryGroupsApiRoutes = require('./routes/api/categoryGroups');
const tagsApiRoutes = require('./routes/api/tags');
const transactionsApiRoutes = require('./routes/api/transactions');
const budgetsApiRoutes = require('./routes/api/budgets');
const rulesApiRoutes = require('./routes/api/rules');
const schedulesApiRoutes = require('./routes/api/schedules');
const importsApiRoutes = require('./routes/api/imports');
const reportsApiRoutes = require('./routes/api/reports');
const adminApiRoutes = require('./routes/api/admin');

const apiRouter = express.Router();
apiRouter.use(apiBaselineLimiter);
apiRouter.use(doubleCsrfProtection);
apiRouter.use('/auth', authApiRoutes);
apiRouter.use('/account', accountApiRoutes);
apiRouter.use('/accounts', accountsApiRoutes);
apiRouter.use('/account-shares', accountSharesApiRoutes);
apiRouter.use('/payees', payeesApiRoutes);
apiRouter.use('/categories', categoriesApiRoutes);
apiRouter.use('/category-groups', categoryGroupsApiRoutes);
apiRouter.use('/tags', tagsApiRoutes);
apiRouter.use('/transactions', transactionsApiRoutes);
apiRouter.use('/budgets', budgetsApiRoutes);
apiRouter.use('/rules', rulesApiRoutes);
apiRouter.use('/schedules', schedulesApiRoutes);
apiRouter.use('/imports', importsApiRoutes);
apiRouter.use('/reports', reportsApiRoutes);
apiRouter.use('/admin', adminApiRoutes);

app.use('/', pagesRoutes);
app.use('/auth', authPagesRoutes);
app.use('/admin', adminPagesRoutes);
app.use('/api', apiRouter);

// 404
app.use((req, res) => {
    res.status(404).render('error', { message: 'Page not found' });
});

// Error handler
app.use((err, req, res, next) => {
    if (err && err.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({ error: 'Invalid or missing CSRF token' });
    }
    if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File is too large (25MB limit)' });
    }
    logger.error('Unhandled error: ' + err.message);
    if (req.path.startsWith('/api/')) {
        return res.status(500).json({ error: 'An unexpected error occurred' });
    }
    res.status(500).render('error', { message: 'An unexpected error occurred' });
});

app.listen(webPort, () => {
    logger.info(`Balanced Waypoints server running at https://${webFQDN}:${webPort}`);
    console.log(`Balanced Waypoints server running at https://${webFQDN}:${webPort}`);
});
