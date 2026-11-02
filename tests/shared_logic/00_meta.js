'use strict';
// Meta checks over the whole of BFShared: a new export has to follow the same rules without every
// module restating them.
exports.TESTS = [];
exports.COUNT = 3;
exports.run = function (ctx) {
    const { BFShared, t } = ctx;
    const keys = Object.keys(BFShared);
    t('BFShared.API_VERSION is the integer 1 until an existing export changes meaning', BFShared.API_VERSION, 1);
    t('every export other than API_VERSION is a function', keys.filter((k) => k !== 'API_VERSION' && typeof BFShared[k] !== 'function'), []);
    t('export names are plain identifiers (no dots, spaces or leading digits)', keys.filter((k) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)), []);
};
