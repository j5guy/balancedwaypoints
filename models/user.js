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
    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
