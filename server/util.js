import { randomBytes } from 'node:crypto';

const DAY = 86400;
export const TTL = { active: 120 * DAY, done: 45 * DAY, waiting: 30 * DAY, list: 400 * DAY };

export const newId = (bytes = 9) => randomBytes(bytes).toString('base64url');

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
