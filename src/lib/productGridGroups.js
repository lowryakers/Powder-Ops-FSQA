// The product grid's column groups, by key, in order — what a saved view's
// "column set" names (R-0645 PR B). ProductGrid.jsx defines the columns in each;
// this list must name the same keys in the same order.
export const GRID_GROUP_KEYS = ['identity', 'formula', 'packaging', 'shipping', 'channels'];
/** Groups folded until somebody opens them. */
export const DEFAULT_COLLAPSED = ['shipping'];
