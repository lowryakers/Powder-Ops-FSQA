// The pack codes in `products.pack`, as a person reads them. One copy for the
// Products catalog and the Artwork board, so both screens filter by the same
// words (D-331). A bottle's printed artwork is its shrink sleeve.
export const PACK_LABEL = Object.freeze({
  PLG: 'Pouch — large', PSM: 'Pouch — small', STK: 'Stick', BOX: 'Carton', CUP: 'Cup', BTL: 'Bottle',
});

// On the Artwork board the printed piece is what is named: a bottle's artwork is
// its shrink SLEEVE, not the bottle (D-334). The pack code and every other label
// are the catalog's.
export const ARTWORK_PACK_LABEL = Object.freeze({ ...PACK_LABEL, BTL: 'Bottle sleeve' });
