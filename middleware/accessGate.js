// Single swap point between the self-hosted and cloud-hosted builds of this
// app. server.js only ever imports THIS file — never middleware/license.js
// directly — so the two deployments can differ by replacing this one file
// and nothing else.
//
// This is the version that ships in the public self-hosted repo/image:
// unconditional license-key gating, no way to disable it via config or env
// var. There's deliberately no DEPLOYMENT_MODE-style flag here — since this
// codebase is open source, any runtime toggle would just be something a
// self-hosted user could flip (or delete) themselves. Raising the bar
// beyond "edit the source" isn't achievable with a flag anyway, so the gate
// is just always on for anyone running this code as-is.
//
// The cloud deployment is built from a private fork/overlay that replaces
// this file's contents with a subscription-status check against our own
// account system instead — self-hosted users never see or run that version,
// so there's nothing here for them to discover or toggle. See
// ../../licensing/README.md's "Cloud vs self-hosted" section.
const { requireLicense } = require('./license');

module.exports = { accessGate: requireLicense };
