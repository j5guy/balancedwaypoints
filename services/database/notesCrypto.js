const { encrypt, decrypt } = require('../../utils/secretCrypto');

// Shared helpers for the `notesIv`/`notesCiphertext` encrypted-text
// convention (AES-256-GCM, see utils/secretCrypto.js) as applied to `notes`
// on Transaction/Schedule/Account, their `splits[].notes`, and (Schedule
// only) `occurrenceOverrides[].notes` / `occurrenceOverrides[].splits[].notes`.

function encryptNotes(notes) {
    const { iv, ciphertext } = encrypt(notes || '');
    return { notesIv: iv, notesCiphertext: ciphertext };
}

function decryptNotes(source) {
    return decrypt({ iv: source.notesIv, ciphertext: source.notesCiphertext }) || '';
}

// Mutates each split (Mongoose subdocument or plain object) in place,
// attaching a plaintext `notes` alongside the stored ciphertext fields.
function decryptSplitsInPlace(splits) {
    (splits || []).forEach((s) => { s.notes = decryptNotes(s); });
    return splits;
}

// Builds a fresh plain array suitable for Transaction/Schedule create()/
// update() — each split's plaintext `notes` becomes notesIv/notesCiphertext.
function encryptSplitsForWrite(splits) {
    return (splits || []).map((s) => ({
        category: s.category,
        amountCents: s.amountCents,
        ...encryptNotes(s.notes)
    }));
}

// Mutates an occurrenceOverrides array in place — same notes + nested splits
// treatment as above.
function decryptOverridesInPlace(overrides) {
    (overrides || []).forEach((o) => {
        o.notes = decryptNotes(o);
        decryptSplitsInPlace(o.splits);
    });
    return overrides;
}

module.exports = { encryptNotes, decryptNotes, decryptSplitsInPlace, encryptSplitsForWrite, decryptOverridesInPlace };
