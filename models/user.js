const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    displayName: {
        type: String,
        trim: true
    },
    isAdmin: {
        type: Boolean,
        default: false
    },
    passwordHash: {
        type: String,
        required: true,
        select: false
    },
    lastLoginAt: {
        type: Date
    },
    // Per-theme overrides for a curated set of CSS custom properties (see
    // public/scss/layout/_base.scss). null/unset means "use the theme
    // default" — never store the app's hardcoded default hex here.
    themeColors: {
        light: {
            text: { type: String, default: null },
            bg: { type: String, default: null },
            accent: { type: String, default: null }
        },
        dark: {
            text: { type: String, default: null },
            bg: { type: String, default: null },
            accent: { type: String, default: null }
        }
    },
    // Register display preferences — persist per-user (not per-browser) so
    // they follow whoever's logged in across devices. Applied on every
    // account's register page (see accounts/show.ejs + public/js/register.js).
    preferences: {
        registerColumns: {
            date: { type: Boolean, default: true },
            payee: { type: Boolean, default: true },
            category: { type: Boolean, default: true },
            notes: { type: Boolean, default: true },
            tags: { type: Boolean, default: true },
            amount: { type: Boolean, default: true },
            balance: { type: Boolean, default: true },
            cleared: { type: Boolean, default: true }
        },
        upcomingSchedules: {
            enabled: { type: Boolean, default: false },
            amount: { type: Number, default: 14 },
            unit: { type: String, enum: ['days', 'months'], default: 'days' }
        }
    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
