const Payee = require('../../models/payee');
const Transaction = require('../../models/transaction');
const { encrypt, decrypt, hashLookup } = require('../../utils/secretCrypto');

// Payee name/address/phone/accountNumber are encrypted at rest (AES-256-GCM,
// see utils/secretCrypto.js) — decorate() attaches plaintext back onto the
// in-memory document so the rest of the app never has to know. `name` also
// gets a deterministic nameHash blind index (models/payee.js's unique index)
// since random-IV ciphertext can't be matched/deduped on directly.
function decorate(doc) {
    if (!doc) return doc;
    doc.name = decrypt({ iv: doc.nameIv, ciphertext: doc.nameCiphertext }) || '';
    doc.address = decrypt({ iv: doc.addressIv, ciphertext: doc.addressCiphertext }) || '';
    doc.phone = decrypt({ iv: doc.phoneIv, ciphertext: doc.phoneCiphertext }) || '';
    doc.accountNumber = decrypt({ iv: doc.accountNumberIv, ciphertext: doc.accountNumberCiphertext }) || '';
    return doc;
}
function decorateAll(docs) { docs.forEach(decorate); return docs; }

function encryptField(fields, name, value) {
    const { iv, ciphertext } = encrypt(value);
    fields[`${name}Iv`] = iv;
    fields[`${name}Ciphertext`] = ciphertext;
}

// Builds the encrypted fields to write, from a payload that may carry any
// mix of name/address/phone/accountNumber (create sends all four; update
// only whichever were actually submitted — same convention prepareWrite()
// followed in services/database/transactions.js).
function prepareWrite({ name, address, phone, accountNumber, ...rest }) {
    const out = { ...rest };
    if (name !== undefined) { encryptField(out, 'name', name); out.nameHash = hashLookup(name); }
    if (address !== undefined) encryptField(out, 'address', address);
    if (phone !== undefined) encryptField(out, 'phone', phone);
    if (accountNumber !== undefined) encryptField(out, 'accountNumber', accountNumber);
    return out;
}

// Sorted here (not in Mongo) since the stored name is ciphertext — per-owner
// payee lists are small, so decrypting first then sorting is cheap.
const list = async (ownerId) => {
    const items = decorateAll(await Payee.find({ owner: ownerId }).populate('transferAccount defaultCategory').exec());
    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
};
const findById = async (id, ownerId) => decorate(await Payee.findOne({ _id: id, owner: ownerId }).exec());
const findByName = async (name, ownerId) => decorate(await Payee.findOne({ owner: ownerId, nameHash: hashLookup(name.trim()) }).exec());
const create = async (data) => decorate(await Payee.create(prepareWrite(data)));
const update = async (id, data, ownerId) => decorate(await Payee.findOneAndUpdate({ _id: id, owner: ownerId }, prepareWrite(data), { new: true, runValidators: true }).exec());

const findOrCreateByName = async (name, ownerId) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = await findByName(trimmed, ownerId);
    if (existing) return existing;
    try {
        return await create({ owner: ownerId, name: trimmed });
    } catch (err) {
        if (err.code === 11000) return findByName(trimmed, ownerId);
        throw err;
    }
};

const remove = async (id, ownerId) => {
    const inUse = await Transaction.exists({ owner: ownerId, payee: id });
    if (inUse) return null;
    return Payee.findOneAndDelete({ _id: id, owner: ownerId }).exec();
};

// Exported so other models that `.populate('payee')` a raw Payee ref
// (services/database/transactions.js, services/database/schedules.js) can
// decrypt it the same way — populate() only pulls the stored
// nameIv/nameCiphertext/etc., it never runs them through decorate() itself.
module.exports = { list, findById, findByName, findOrCreateByName, create, update, remove, decorate };
