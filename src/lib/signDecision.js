// Send a product decision, signed with the person's password (D-195). The
// prompt names the decision in one line, so it is clear what is being signed.
// The first request carries no password; the server asks only once the
// decision is complete and allowed.
import { withSignature } from './signature.js';
import { DISPOSITIONS } from '../../shared/product-disposition.js';

export function signDecision(send, value) {
  const label = DISPOSITIONS[value?.disposition]?.label || 'Product decision';
  const lots = String(value?.lots || '').trim();
  return withSignature(send, {
    title: 'Sign this product decision',
    detail: `${label}${lots ? ` · lots ${lots}` : ''}. Enter the password you sign in with.`,
  });
}
