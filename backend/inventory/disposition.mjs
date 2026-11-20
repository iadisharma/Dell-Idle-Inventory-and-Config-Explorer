export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const actionPermissions = Object.freeze({
  propose: 'plan:propose', approve: 'plan:decide', reject: 'plan:decide', cancel: 'plan:decide', execute: 'plan:execute'
});

export function textField(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new RequestError(400, label + ' must contain 1 to ' + maxLength + ' characters.');
  }
  return value.trim();
}

export function checkBody(payload, allowed) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => !allowed.includes(key))) {
    throw new RequestError(400, 'Invalid request fields.');
  }
}

export function requirePermission(actor, permission) {
  if (!actor?.id || !actor?.name || !Array.isArray(actor.permissions)) throw new RequestError(401, 'Sign in to continue.');
  if (!actor.permissions.includes(permission)) throw new RequestError(403, 'Your role cannot perform this action.');
}

export function stageOf(review, statuses) {
  // A legacy case may already have a final outcome without a disposition plan.
  if (review.dispositionStage) return review.dispositionStage;
  return statuses.find(status => status.id === review.status)?.terminal === false ? 'open' : 'closed';
}

export function allowedActions(review, statuses, actor) {
  if (!actor) return [];
  const stage = stageOf(review, statuses);
  let actions = [];
  if (stage === 'open') actions = ['propose'];
  const proposer = review.proposal?.actorId;
  const decider = review.decision?.actorId;
  if (stage === 'proposed' && proposer && proposer !== actor.id) actions = ['approve', 'reject'];
  if (stage === 'approved') {
    actions = ['cancel'];
    if (proposer && decider && decider !== proposer && decider !== actor.id && review.decision.action === 'approve') {
      actions.push('execute');
    }
  }
  return actions.filter(action => actor.permissions.includes(actionPermissions[action]));
}

export function statusDefinitions(existing, workflow) {
  const executed = existing.find(status => status.terminal && !status.stage);
  if (!executed) throw new Error('Define a terminal status for executed dispositions.');
  const definition = { cancelled: { id: 'cancelled', label: 'Cancelled' }, ...workflow, executed };
  const ids = new Set(existing.map(status => status.id));
  const appended = [];
  for (const stage of ['proposed', 'approved', 'rejected', 'cancelled']) {
    const entry = definition[stage];
    if (typeof entry?.id !== 'string' || !entry.id.trim() || typeof entry.label !== 'string' || !entry.label.trim() || ids.has(entry.id)) {
      throw new Error('Invalid or conflicting disposition status: ' + stage);
    }
    ids.add(entry.id);
    appended.push({ id: entry.id, label: entry.label, initial: false, terminal: ['rejected', 'cancelled'].includes(stage), stage });
  }
  const statuses = [...existing, ...appended].map(status => {
    let next = [];
    if (!status.terminal) {
      if (status.stage === 'proposed') next = [workflow.approved.id, workflow.rejected.id];
      else if (status.stage === 'approved') next = [executed.id, definition.cancelled.id];
      else next = [workflow.proposed.id];
    }
    return { ...status, next };
  });
  return { statuses, definition };
}

export function normalizedAction(body) {
  checkBody(body, ['action', 'expectedUpdatedAt', 'quantity', 'note']);
  if (typeof body.action !== 'string' || !Object.hasOwn(actionPermissions, body.action)) {
    throw new RequestError(400, 'Unknown disposition action.');
  }
  const expectedUpdatedAt = textField(body.expectedUpdatedAt, 'Expected version', 50);
  const note = body.action === 'execute' && (body.note == null || body.note === '')
    ? 'Approved quantity issued from stock.' : textField(body.note, 'Reason', 2000);
  if (body.action === 'propose') {
    if (!Number.isSafeInteger(body.quantity) || body.quantity <= 0) throw new RequestError(400, 'Propose a positive whole number of units.');
  } else if (Object.hasOwn(body, 'quantity')) {
    throw new RequestError(400, 'Quantity is set when the plan is proposed.');
  }
  return { action: body.action, expectedUpdatedAt, note, quantity: body.quantity };
}
