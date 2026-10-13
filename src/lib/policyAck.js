// Open the policy acknowledgement modal from anywhere (the card, a list). The
// modal is owned by PolicyAckHost, mounted once per layout (D-169).
export const POLICY_ACK_EVENT = 'open-policy-ack';
export const openPolicyAck = (id) => window.dispatchEvent(new CustomEvent(POLICY_ACK_EVENT, { detail: { id } }));
